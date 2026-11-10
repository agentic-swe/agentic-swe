'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const { createRuntime } = require('../scripts/lib/hosted-runtime/index.cjs');
const { ToolRegistry, ToolRunner, createRemainingTools } = require('../scripts/lib/tools/index.cjs');
const { readJournal } = require('../scripts/lib/shared/journal.cjs');
const { extractReceipt } = require('../scripts/lib/receipt/extract.cjs');
const { createFixtureAdapter } = require('../scripts/lib/model-gateway/index.cjs');
const { applyTransition } = require('../scripts/lib/work-engine/engine.cjs');

function work(track = 'lean') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-020c-runtime-'));
  const workDir = path.join(tmp, '.worklogs', 'runtime');
  const init = spawnSync(process.execPath, [
    path.join(root, 'scripts/work-engine.cjs'), 'init',
    '--id', 'runtime', '--task', 'fixture task', '--work-root', tmp,
    '--budget-profile', track, '--plugin-root', root, '--json',
  ], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return { tmp, workDir };
}

function toolRegistry(executed) {
  return new ToolRegistry([{
    manifest: {
      id: 'fixture.side-effect',
      version: '1.0.0',
      permissions: [],
      input_schema: { type: 'object', additionalProperties: false },
      side_effects: 'local',
      idempotency: 'non-idempotent',
      timeout_ms: 1000,
    },
    execute: async () => {
      executed.push('ran');
      return { status: 'ok', data: { changed: true } };
    },
  }]);
}

function gatewayFor(scenarios) {
  return {
    async route(req) {
      const body = scenarios[req.scenario] || { content: '{"ok":true}', tool_calls: [] };
      return {
        content: body.content || null,
        tool_calls: body.tool_calls || [],
        finish_reason: body.tool_calls?.length ? 'tool_calls' : 'stop',
        model: req.scenario ? `fixture-${req.scenario}` : 'fixture-default',
        provider: 'fixture',
        usage: {
          input: 1, output: 1, usage_source: 'provider', usd: 0,
          cost_source: 'local', latency_ms: 0,
        },
      };
    },
  };
}

describe('AE-020c hosted runtime', () => {
  it('reaches approval-wait with verifiable model, tool, policy, and receipt evidence', async () => {
    const { tmp, workDir } = work('lean');
    const executed = [];
    const runtime = createRuntime({
      workDir,
      pluginRoot: root,
      track: 'lean',
      gateway: gatewayFor({
        feasibility: { tool_calls: [{ id: 's1', name: 'fixture.side-effect', arguments: {} }] },
      }),
      tools: [{
        manifest: {
          id: 'fixture.side-effect',
          version: '1.0.0',
          permissions: [],
          input_schema: { type: 'object', additionalProperties: false },
          side_effects: 'local',
          idempotency: 'non-idempotent',
          timeout_ms: 1000,
        },
        execute: async () => {
          executed.push('ran');
          return { status: 'ok', data: { changed: true } };
        },
      }],
      steps: { feasibility: { scenario: 'feasibility', tier: 'fast', tools: [{ name: 'fixture.side-effect' }] } },
    });
    const result = await runtime.run();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.current_state, 'approval-wait');
    assert.deepEqual(executed, ['ran']);
    assert.equal(readJournal(workDir).ok, true);
    const receipt = extractReceipt(workDir);
    assert.equal(receipt.integrity, 'verified');
    assert.ok(receipt.usage.length >= 6);
    assert.ok(receipt.toolCalls.some((call) => call.tool_id === 'fixture.side-effect'));
    assert.ok(receipt.policyDecisions.length >= 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('runs standard and rigorous paths, recording an independent rigorous review', async () => {
    for (const track of ['standard', 'rigorous']) {
      const { tmp, workDir } = work(track);
      const result = await createRuntime({
        workDir, pluginRoot: root, track,
        gateway: gatewayFor({}),
        steps: {},
        reviewerModel: 'fixture-reviewer',
      }).run();
      assert.equal(result.ok, true, `${track}: ${JSON.stringify(result)}`);
      const state = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
      assert.equal(state.current_state, 'approval-wait');
      if (track === 'rigorous') {
        const review = state.reviews.find((entry) => entry.reviewer === 'security-reviewer');
        assert.equal(review.independence, 'independent');
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('denies a policy-banned tool without executing it and resumes idempotently', async () => {
    const { tmp, workDir } = work('lean');
    const executed = [];
    const policy = {
      version: 'fixture',
      banned_tools: [{ id: 'fixture-deny', tool: 'fixture.side-effect', reason: 'fixture deny' }],
    };
    const options = {
      workDir, pluginRoot: root, track: 'lean', policy,
      gateway: gatewayFor({
        feasibility: { tool_calls: [{ id: 'blocked', name: 'fixture.side-effect', arguments: {} }] },
      }),
      toolRunner: undefined,
      tools: [{
        manifest: {
          id: 'fixture.side-effect', version: '1.0.0', permissions: [],
          input_schema: { type: 'object' }, side_effects: 'local',
          idempotency: 'non-idempotent', timeout_ms: 1000,
        },
        execute: async () => { executed.push('ran'); return { status: 'ok' }; },
      }],
      steps: { feasibility: { scenario: 'feasibility', tools: [{ name: 'fixture.side-effect' }] } },
    };
    const first = await createRuntime(options).run({ stopAfter: 3 });
    assert.equal(first.code, 'RUNTIME_STOPPED');
    assert.deepEqual(executed, []);
    const denied = readJournal(workDir).events.find((event) =>
      event.type === 'policy.decided' && event.payload.decision === 'deny'
    );
    assert.ok(denied);
    const second = await createRuntime(options).run();
    assert.equal(second.current_state, 'approval-wait');
    assert.deepEqual(executed, []);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('switches local provider configuration without changing the orchestration', async () => {
    for (const provider of ['fixture', 'ollama']) {
      const { tmp, workDir } = work('lean');
      const adapter = createFixtureAdapter();
      const result = await createRuntime({
        workDir, pluginRoot: root, track: 'lean', provider,
        adapters: { [provider]: adapter },
        gatewayConfig: { models: { fast: [`${provider}-fast`] } },
      }).run();
      assert.equal(result.current_state, 'approval-wait');
      const usage = readJournal(workDir).events.filter((event) => event.type === 'usage.recorded');
      assert.ok(usage.length >= 6);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('F-M2-06: lean path uses createModelGateway transport (not a stub gateway)', async () => {
    const { tmp, workDir } = work('lean');
    const executed = [];
    const transports = [];
    const sideEffectTool = {
      manifest: {
        id: 'fixture.side-effect',
        version: '1.0.0',
        permissions: [],
        input_schema: { type: 'object', additionalProperties: false },
        side_effects: 'local',
        idempotency: 'non-idempotent',
        timeout_ms: 1000,
      },
      execute: async () => {
        executed.push('ran');
        return { status: 'ok', data: { changed: true } };
      },
    };
    // No `gateway:` option — must go through defaultGateway → createModelGateway.
    const result = await createRuntime({
      workDir,
      pluginRoot: root,
      track: 'lean',
      tools: [sideEffectTool],
      steps: { feasibility: { scenario: 'feasibility', tier: 'fast', tools: [{ name: 'fixture.side-effect' }] } },
      transport: async (req) => {
        transports.push({ model: req.model, scenario: req.scenario, tools: req.tools });
        if (req.scenario === 'feasibility') {
          return {
            body: {
              message: {
                role: 'assistant',
                content: '',
                tool_calls: [{
                  id: 'gw1',
                  function: { name: 'fixture.side-effect', arguments: {} },
                }],
              },
              done: true,
              model: req.model,
              prompt_eval_count: 1,
              eval_count: 1,
            },
          };
        }
        return {
          body: {
            message: { role: 'assistant', content: '{"ok":true}' },
            done: true,
            model: req.model,
            prompt_eval_count: 1,
            eval_count: 1,
          },
        };
      },
    }).run();
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.current_state, 'approval-wait');
    assert.ok(transports.length >= 6, `expected real gateway transport calls, got ${transports.length}`);
    assert.ok(transports.some((t) => t.scenario === 'feasibility'));
    assert.deepEqual(executed, ['ran']);
    assert.ok(readJournal(workDir).events.some((e) => e.type === 'usage.recorded'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('F-M2-06 AC4: kill after successful tool does not re-execute on resume', async () => {
    const { tmp, workDir } = work('lean');
    const executed = [];
    const options = {
      workDir,
      pluginRoot: root,
      track: 'lean',
      gateway: gatewayFor({
        feasibility: { tool_calls: [{ id: 'ok1', name: 'fixture.side-effect', arguments: {} }] },
      }),
      tools: [{
        manifest: {
          id: 'fixture.side-effect',
          version: '1.0.0',
          permissions: [],
          input_schema: { type: 'object', additionalProperties: false },
          side_effects: 'local',
          idempotency: 'non-idempotent',
          timeout_ms: 1000,
        },
        execute: async () => {
          executed.push('ran');
          return { status: 'ok', data: { changed: true } };
        },
      }],
      // stepFor keys on current_state (from), so the side-effect runs leaving feasibility.
      steps: { feasibility: { scenario: 'feasibility', tools: [{ name: 'fixture.side-effect' }] } },
    };
    const killed = await createRuntime(options).run({ stopAfter: 2 });
    assert.equal(killed.code, 'RUNTIME_STOPPED');
    assert.equal(killed.current_state, 'lean-track-check');
    assert.deepEqual(executed, ['ran'], 'side effect must complete before kill');
    const toolRequests = readJournal(workDir).events.filter((e) => e.type === 'tool.requested');
    assert.equal(toolRequests.length, 1);
    const resumed = await createRuntime(options).run();
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.current_state, 'approval-wait');
    assert.deepEqual(executed, ['ran'], 'resume must not re-execute the completed side effect');
    assert.equal(
      readJournal(workDir).events.filter((e) => e.type === 'tool.requested').length,
      1,
      'no additional tool.requested on resume past the kill point'
    );
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('F-M2-06 AC6: cannot leave approval-wait or push without a human grant', async () => {
    const { tmp, workDir } = work('lean');
    const executed = [];
    const options = {
      workDir,
      pluginRoot: root,
      track: 'lean',
      gateway: gatewayFor({
        feasibility: { tool_calls: [{ id: 's1', name: 'fixture.side-effect', arguments: {} }] },
      }),
      tools: [{
        manifest: {
          id: 'fixture.side-effect',
          version: '1.0.0',
          permissions: [],
          input_schema: { type: 'object', additionalProperties: false },
          side_effects: 'local',
          idempotency: 'non-idempotent',
          timeout_ms: 1000,
        },
        execute: async () => {
          executed.push('ran');
          return { status: 'ok' };
        },
      }],
      steps: { feasibility: { scenario: 'feasibility', tools: [{ name: 'fixture.side-effect' }] } },
    };
    const first = await createRuntime(options).run();
    assert.equal(first.current_state, 'approval-wait');
    assert.deepEqual(executed, ['ran']);
    const parked = await createRuntime(options).run();
    assert.equal(parked.ok, true);
    assert.equal(parked.current_state, 'approval-wait');
    assert.deepEqual(executed, ['ran'], 'parked re-run must not drive tools');

    const leave = applyTransition({
      workDir,
      pluginRoot: root,
      to: 'completed',
      actor: 'hosted-runtime',
      skipMuscleMemory: true,
    });
    assert.equal(leave.ok, false);
    assert.equal(leave.code, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8')).current_state,
      'approval-wait'
    );

    const calls = [];
    const tools = createRemainingTools({
      run: async (file, args) => {
        calls.push([file, ...args]);
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const runner = new ToolRunner({
      registry: new ToolRegistry(tools),
      workDir,
      pdp: { evaluate: () => ({ decision: 'allow' }) },
    });
    const push = await runner.run('git.push', { branch: 'feature/f-m2-06' });
    assert.equal(push.status, 'error');
    assert.equal(push.error.code, 'DENIED_UNAUTHORIZED');
    assert.equal(calls.length, 0, 'git push must not spawn without grant');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('F-M2-03b: critical_failure stops the loop and escalates', async () => {
    const { tmp, workDir } = work('lean');
    const registry = new ToolRegistry([{
      manifest: {
        id: 'fixture.side-effect',
        version: '1.0.0',
        permissions: [],
        input_schema: { type: 'object', additionalProperties: false },
        side_effects: 'local',
        idempotency: 'non-idempotent',
        timeout_ms: 1000,
      },
      execute: async () => ({ status: 'ok', data: {} }),
    }]);
    let criticalSeen = false;
    const runtime = createRuntime({
      workDir,
      pluginRoot: root,
      track: 'lean',
      registry,
      pdp: {
        evaluate: ({ toolName }) => {
          if (toolName === 'fixture.side-effect') {
            criticalSeen = true;
            return {
              decision: 'deny',
              rule_id: 'policy.critical',
              policy_digest: 'c'.repeat(64),
              risk_class: 'critical',
              reason: 'injected critical failure',
              code: 'POLICY_CRITICAL',
              critical_failure: true,
            };
          }
          return {
            decision: 'allow',
            rule_id: 'test.allow',
            policy_digest: 'a'.repeat(64),
            risk_class: 'low',
            reason: 'test',
          };
        },
      },
      gateway: gatewayFor({
        feasibility: { content: '{"ok":true}', tool_calls: [] },
        'lean-track-check': { content: '{"ok":true}', tool_calls: [] },
        'lean-track-implementation': {
          content: null,
          tool_calls: [{ id: '1', name: 'fixture.side-effect', arguments: {} }],
        },
      }),
      steps: {
        feasibility: { scenario: 'feasibility' },
        'lean-track-check': { scenario: 'lean-track-check' },
        'lean-track-implementation': { scenario: 'lean-track-implementation', tools: [{ name: 'fixture.side-effect' }] },
      },
    });
    const result = await runtime.run();
    assert.equal(result.ok, false);
    assert.equal(result.code, 'CRITICAL_POLICY_FAILURE');
    assert.equal(result.current_state, 'escalate-code');
    assert.equal(criticalSeen, true);
    const journal = readJournal(workDir);
    assert.ok(journal.ok);
    assert.ok(journal.events.some((e) => e.type === 'runtime.critical_failure'));
    assert.ok(fs.existsSync(path.join(workDir, 'review-feedback.md')));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
