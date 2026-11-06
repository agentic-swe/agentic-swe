'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const { createRuntime } = require('../scripts/lib/hosted-runtime/index.cjs');
const { ToolRegistry } = require('../scripts/lib/tools/index.cjs');
const { readJournal } = require('../scripts/lib/shared/journal.cjs');
const { extractReceipt } = require('../scripts/lib/receipt/extract.cjs');
const { createFixtureAdapter } = require('../scripts/lib/model-gateway/index.cjs');

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
});
