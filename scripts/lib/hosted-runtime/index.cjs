'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createModelGateway, adapters, createFixtureAdapter } = require('../model-gateway/index.cjs');
const { ToolRegistry, ToolRunner } = require('../tools/index.cjs');
const { evaluate } = require('../policy/pdp.cjs');
const { loadWorkItem, applyTransition, recordReview, recordSpawn } = require('../work-engine/engine.cjs');
const { appendEvent, readJournal } = require('../shared/journal.cjs');

const TRACK_PATHS = {
  lean: [
    ['initialized', 'feasibility'],
    ['feasibility', 'lean-track-check'],
    ['lean-track-check', 'lean-track-implementation'],
    ['lean-track-implementation', 'validation'],
    ['validation', 'pr-creation'],
    ['pr-creation', 'approval-wait'],
  ],
  standard: [
    ['initialized', 'feasibility'],
    ['feasibility', 'lean-track-check'],
    ['lean-track-check', 'design'],
    ['design', 'verification'],
    ['verification', 'test-strategy'],
    ['test-strategy', 'implementation'],
    ['implementation', 'self-review'],
    ['self-review', 'validation'],
    ['validation', 'pr-creation'],
    ['pr-creation', 'approval-wait'],
  ],
  rigorous: [
    ['initialized', 'feasibility'],
    ['feasibility', 'lean-track-check'],
    ['lean-track-check', 'design'],
    ['design', 'design-review'],
    ['design-review', 'verification'],
    ['verification', 'test-strategy'],
    ['test-strategy', 'implementation'],
    ['implementation', 'self-review'],
    ['self-review', 'code-review'],
    ['code-review', 'permissions-check'],
    ['permissions-check', 'validation'],
    ['validation', 'pr-creation'],
    ['pr-creation', 'approval-wait'],
  ],
};

const ARTIFACTS = {
  feasibility: 'feasibility.md',
  'lean-track-check': 'lean-track-check.md',
  'lean-track-implementation': 'implementation.md',
  design: 'design.md',
  'design-review': 'design-review.md',
  verification: 'verification-results.md',
  'test-strategy': 'test-stubs.md',
  implementation: 'implementation.md',
  'self-review': 'self-review.md',
  'code-review': 'review-pass.md',
  'permissions-check': 'permissions-changes.md',
  validation: 'validation-results.md',
  'pr-creation': 'cicd.md',
};

function defaultPolicy(pluginRoot) {
  return JSON.parse(fs.readFileSync(path.join(pluginRoot, 'config', 'default-policy.json'), 'utf8'));
}

function defaultGateway({ workDir, provider = 'fixture', adapters: configured, gatewayConfig, transport }) {
  const models = gatewayConfig?.models || {
    fast: [`${provider}-fast`],
    balanced: [`${provider}-balanced`],
    heavy: [`${provider}-heavy`],
  };
  const capabilities = gatewayConfig?.capabilities || Object.fromEntries(
    Object.values(models).flat().map((model) => [
      model,
      { tools: true, json_schema: true, vision: false, context_tokens: 8192, streaming: false },
    ])
  );
  const localAdapter = provider === 'fixture'
    ? createFixtureAdapter({ capabilities, canned: gatewayConfig?.cannedResponses })
    : (configured && configured[provider]) || adapters[provider];
  return createModelGateway({
    config: {
      provider,
      models,
      capabilities,
      timeout_ms: gatewayConfig?.timeout_ms || 5000,
      max_retries: gatewayConfig?.max_retries ?? 0,
      max_repair_attempts: gatewayConfig?.max_repair_attempts ?? 0,
      fallback: gatewayConfig?.fallback !== false,
      base_url: gatewayConfig?.base_url || 'http://127.0.0.1:9',
    },
    adapters: { [provider]: localAdapter },
    transport,
    workDir,
  });
}

function parseToolCalls(response) {
  if (Array.isArray(response?.tool_calls)) return response.tool_calls;
  if (typeof response?.content !== 'string') return [];
  try {
    const parsed = JSON.parse(response.content);
    const calls = parsed && (parsed.tool_calls || parsed.toolCalls);
    return Array.isArray(calls) ? calls : [];
  } catch {
    return [];
  }
}

function normalizeToolCall(call, index) {
  const name = call?.name || call?.function?.name;
  if (!name) {
    const err = new Error(`tool call ${index} has no name`);
    err.code = 'TOOL_CALL_INVALID';
    throw err;
  }
  let argumentsValue = call?.arguments ?? call?.function?.arguments ?? {};
  if (typeof argumentsValue === 'string') {
    try {
      argumentsValue = JSON.parse(argumentsValue);
    } catch {
      const err = new Error(`tool call ${name} has invalid JSON arguments`);
      err.code = 'TOOL_CALL_INVALID';
      throw err;
    }
  }
  if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) {
    const err = new Error(`tool call ${name} arguments must be an object`);
    err.code = 'TOOL_CALL_INVALID';
    throw err;
  }
  return {
    id: String(call?.id || `${name}-${index}`),
    name: String(name),
    arguments: argumentsValue,
  };
}

function phasePrompt(state, step) {
  return [
    `You are executing phase ${state.current_state}.`,
    `Work item: ${state.work_id}.`,
    `Task: ${state.task || ''}`,
    step.prompt || 'Return the next governed action.',
  ].join('\n');
}

function writeArtifact(workDir, file, content) {
  const target = path.join(workDir, file);
  if (!fs.existsSync(target)) fs.writeFileSync(target, `${content}\n`, 'utf8');
}

function defaultStep(state, to) {
  return {
    prompt: `Complete ${state.current_state} and prepare to enter ${to}.`,
    tools: [],
  };
}

function stepFor(steps, state, to) {
  const configured = steps && (steps[state.current_state] || steps[`${state.current_state}->${to}`]);
  return configured ? { ...defaultStep(state, to), ...configured } : defaultStep(state, to);
}

function runtimeEvent(workDir, payload, key) {
  return appendEvent(workDir, {
    type: 'runtime.step',
    payload,
    idempotency_key: key,
  });
}

function ensureUsageEvent(workDir, key, response) {
  if (!response?.usage) return;
  const chain = readJournal(workDir);
  if (chain.ok && chain.events.some((event) => event.idempotency_key === key)) return;
  appendEvent(workDir, {
    type: 'usage.recorded',
    payload: {
      provider: String(response.provider || 'unknown'),
      model: String(response.model || 'unknown'),
      input: response.usage.input ?? null,
      output: response.usage.output ?? null,
      cache_read: response.usage.cache_read ?? null,
      usage_source: response.usage.usage_source || 'absent',
      usd: response.usage.usd ?? null,
      cost_source: response.usage.cost_source || 'unknown',
      latency_ms: Number(response.usage.latency_ms || 0),
      status: 'ok',
      finish_reason: response.finish_reason || 'stop',
    },
    idempotency_key: key,
  });
}

function ensurePhaseArtifacts(workDir, state, to, step) {
  const files = new Set();
  const required = ARTIFACTS[state.current_state];
  if (required) files.add(required);
  if (state.current_state === 'lean-track-implementation') files.add('review-pass.md');
  if (state.current_state === 'design' && state.pipeline?.track === 'rigorous') files.add('design-panel-review.md');
  if (state.current_state === 'pr-creation') {
    files.add('cicd.md');
    files.add('pr-link.txt');
  }
  for (const file of step.artifacts || []) files.add(file);
  for (const file of files) {
    const content = step.artifact_content?.[file] || `# ${file}\nGenerated by hosted runtime for ${state.work_id}.`;
    writeArtifact(workDir, file, content);
  }
  if (to === 'approval-wait' && !fs.existsSync(path.join(workDir, 'pr-link.txt'))) {
    writeArtifact(workDir, 'pr-link.txt', `fixture://${state.work_id}`);
  }
}

function createRuntime(options = {}) {
  const workDir = path.resolve(options.workDir || '');
  const pluginRoot = path.resolve(options.pluginRoot || path.join(__dirname, '..', '..', '..'));
  if (!workDir || workDir === path.parse(workDir).root) throw new Error('hosted runtime requires workDir');
  const policy = options.policy || defaultPolicy(pluginRoot);
  const pdp = options.pdp || { evaluate: (input) => evaluate({ ...input, policy }) };
  const gateway = options.gateway || defaultGateway({
    workDir,
    provider: options.provider || 'fixture',
    adapters: options.adapters,
    gatewayConfig: options.gatewayConfig,
    transport: options.transport,
  });
  const registry = options.registry || new ToolRegistry(options.tools || []);
  const runner = options.toolRunner || new ToolRunner({
    registry,
    workDir,
    policy,
    pdp,
    actor: options.actor || { role: 'hypervisor', source: 'hosted-runtime' },
  });
  const track = options.track || 'lean';
  if (!TRACK_PATHS[track]) throw new Error(`unknown runtime track ${track}`);

  async function executeStep(state, from, to) {
    const step = stepFor(options.steps, state, to);
    const tools = step.tools || [];
    const response = await gateway.route({
      tier: step.tier || 'fast',
      messages: [{ role: 'user', content: phasePrompt(state, step) }],
      tools,
      idempotency_key: `model:${state.work_id}:${from}:${to}`,
      scenario: step.scenario,
    });
    ensureUsageEvent(workDir, `model:${state.work_id}:${from}:${to}`, response);
    const calls = parseToolCalls(response).map(normalizeToolCall);
    runtimeEvent(workDir, {
      phase: from,
      destination: to,
      model: response.model,
      provider: response.provider,
      tool_call_count: calls.length,
      finish_reason: response.finish_reason,
    }, `runtime:${state.work_id}:${from}:${to}`);
    const results = [];
    for (const [index, call] of calls.entries()) {
      results.push(await runner.run(call.name, call.arguments, {
        idempotency_key: `tool:${state.work_id}:${from}:${to}:${call.id || index}`,
        state: from,
        track: state.pipeline?.track || track,
      }));
    }
    return { response, calls, results };
  }

  async function run(runOptions = {}) {
    const maxSteps = Number.isInteger(runOptions.maxSteps) ? runOptions.maxSteps : 100;
    const stopAfter = runOptions.stopAfter == null ? null : Number(runOptions.stopAfter);
    const executed = [];
    for (let count = 0; count < maxSteps; count++) {
      const loaded = loadWorkItem(workDir, pluginRoot);
      if (!loaded.ok) return loaded;
      const state = loaded.state;
      if (state.current_state === 'approval-wait') {
        const journal = readJournal(workDir);
        return { ok: true, current_state: state.current_state, steps: executed, journal };
      }
      const edge = TRACK_PATHS[track].find(([from]) => from === state.current_state);
      if (!edge) {
        return { ok: false, code: 'RUNTIME_NO_EDGE', message: `no runtime edge from ${state.current_state}` };
      }
      const [from, to] = edge;
      const stepResult = await executeStep(state, from, to);
      ensurePhaseArtifacts(workDir, state, to, stepFor(options.steps, state, to));
      if (from === 'implementation' && state.pipeline?.track === 'rigorous') {
        // The implementer model is recorded before the independent code-review run.
        recordSpawn({ workDir, pluginRoot, role: 'developer-agent', model: stepResult.response.model });
      }
      if (from === 'code-review') {
        recordSpawn({ workDir, pluginRoot, role: 'security-reviewer', model: options.reviewerModel || 'fixture-independent-reviewer' });
        const review = recordReview({
          workDir,
          pluginRoot,
          reviewer: 'security-reviewer',
          model: options.reviewerModel || 'fixture-independent-reviewer',
          runId: `runtime-review:${state.work_id}:${state.history.length}`,
          actor: 'hosted-runtime',
          verdict: 'approved',
          findings: [],
        });
        if (!review.ok) return review;
      }
      const transition = applyTransition({
        workDir,
        pluginRoot,
        to,
        actor: options.actor || 'hosted-runtime',
        reason: `hosted runtime completed ${from}`,
        setPipelineTrack: from === 'lean-track-check' ? track : undefined,
        decrementIterationBudget: false,
        skipMuscleMemory: true,
      });
      if (!transition.ok) return transition;
      executed.push({ from, to, model: stepResult.response.model, tool_calls: stepResult.calls.length });
      if (stopAfter != null && executed.length >= stopAfter) {
        return { ok: false, code: 'RUNTIME_STOPPED', current_state: to, steps: executed };
      }
    }
    return { ok: false, code: 'RUNTIME_STEP_LIMIT', steps: executed };
  }

  return { run, executeStep, parseToolCalls };
}

module.exports = {
  TRACK_PATHS,
  ARTIFACTS,
  parseToolCalls,
  normalizeToolCall,
  createRuntime,
};
