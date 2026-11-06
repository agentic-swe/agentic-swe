'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ToolRegistry, ToolRunner, createGitHubTools, createTestRunnerTool } = require('../scripts/lib/tools/index.cjs');
const { memoryCallJournal } = require('../scripts/lib/github/call-journal.cjs');
const { createGitHubConnector } = require('../scripts/lib/github/connector.cjs');
const { readJournal } = require('../scripts/lib/shared/journal.cjs');

const root = path.join(__dirname, '..');
const manifest = (id, extra = {}) => ({
  id, version: '1.0.0', permissions: [], input_schema: { type: 'object' },
  side_effects: 'none', idempotency: 'idempotent', timeout_ms: 1000, ...extra,
});
const allowPdp = { evaluate: () => ({ decision: 'allow', rule_id: 'test.allow', policy_digest: 'a'.repeat(64), risk_class: 'low', reason: 'test' }) };
const denyPdp = { evaluate: () => ({ decision: 'deny', rule_id: 'test.deny', policy_digest: 'b'.repeat(64), risk_class: 'high', reason: 'denied', code: 'DENIED' }) };
function work() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool-runner-'));
  const workDir = path.join(rootDir, '.worklogs', 'item');
  fs.mkdirSync(workDir, { recursive: true });
  return { rootDir, workDir };
}

describe('AE-021a tool contract and runner', () => {
  it('1: rejects an invalid manifest and accepts schema-valid registered tools', () => {
    assert.throws(() => new ToolRegistry([{ manifest: { id: 'bad' }, execute() {} }]), /invalid tool manifest/);
    const registry = new ToolRegistry([{ manifest: manifest('fixture.read'), execute: async () => ({ data: 1 }) }]);
    assert.equal(registry.has('fixture.read'), true);
    assert.match(registry.digest(), /^[a-f0-9]{64}$/);
  });

  it('2: policy-denied tools never execute and journal policy.decided', async () => {
    const { rootDir, workDir } = work();
    let calls = 0;
    const registry = new ToolRegistry([{ manifest: manifest('fixture.side'), execute: async () => { calls++; } }]);
    const result = await new ToolRunner({ registry, workDir, pdp: denyPdp }).run('fixture.side', {});
    assert.equal(result.status, 'denied');
    assert.equal(calls, 0);
    const events = readJournal(workDir).events;
    assert.equal(events.filter((e) => e.type === 'policy.decided').length, 1);
    assert.equal(events.filter((e) => e.type === 'tool.completed').length, 1);
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('3: remote tools carry declared permissions and remain policy-gated', async () => {
    const { rootDir, workDir } = work();
    const registry = new ToolRegistry([{ manifest: manifest('remote.write', {
      permissions: ['github.pr.write'], side_effects: 'remote', idempotency: 'non-idempotent',
    }), execute: async () => ({ data: 'written', effects: 'applied' }) }]);
    const result = await new ToolRunner({ registry, workDir, pdp: denyPdp }).run('remote.write', {});
    assert.equal(result.status, 'denied');
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('4: timeout aborts execution and marks remote effects unknown', async () => {
    const { rootDir, workDir } = work();
    const registry = new ToolRegistry([{ manifest: manifest('slow.remote', {
      side_effects: 'remote', idempotency: 'non-idempotent', timeout_ms: 10,
    }), execute: (_, ctx) => new Promise((resolve) => {
      ctx.signal.addEventListener('abort', () => resolve({ status: 'timeout' }));
    }) }]);
    const result = await new ToolRunner({ registry, workDir, pdp: allowPdp }).run('slow.remote', {});
    assert.equal(result.status, 'timeout');
    assert.equal(result.effects, 'unknown');
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('5: GitHub and test runner adapters normalize results and redact output by reference', async () => {
    const { rootDir, workDir } = work();
    const requests = [];
    const connector = createGitHubConnector({
      token: 'ghp_test', journal: memoryCallJournal(),
      config: { api_base: 'https://api.github.test', authorization: { github_write: false }, permissions: { read: ['pull_requests:read'] } },
      transport: async ({ method, url }) => { requests.push({ method, url }); return { status: 200, data: { title: 'fixture' } }; },
    });
    const entries = [...createGitHubTools(connector), {
      manifest: manifest('fixture.secret', { timeout_ms: 1000 }),
      execute: async () => ({ stdout: 'token=ghp_12345678901234567890' }),
    }];
    const runner = new ToolRunner({ registry: new ToolRegistry(entries), workDir, pdp: allowPdp });
    const github = await runner.run('github.get_pull', { repo: 'acme/widgets', number: 42 });
    const secret = await runner.run('fixture.secret', {});
    assert.equal(github.status, 'ok');
    assert.equal(requests.length, 1);
    assert.match(secret.stdout_ref.path, /tool-output/);
    assert.doesNotMatch(fs.readFileSync(path.join(workDir, secret.stdout_ref.path), 'utf8'), /ghp_/);
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('6: non-idempotent retries return the recorded result without executing twice', async () => {
    const { rootDir, workDir } = work();
    let calls = 0;
    const registry = new ToolRegistry([{ manifest: manifest('remote.once', { side_effects: 'remote', idempotency: 'non-idempotent' }), execute: async () => ({ data: ++calls, effects: 'applied' }) }]);
    const runner = new ToolRunner({ registry, workDir, pdp: allowPdp });
    const first = await runner.run('remote.once', {}, { idempotency_key: 'same' });
    const second = await runner.run('remote.once', {}, { idempotency_key: 'same' });
    assert.equal(calls, 1);
    assert.deepEqual(second, first);
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('7: test-runner executes argv without a shell and uses the shared normalized contract', async () => {
    const { rootDir, workDir } = work();
    const entry = createTestRunnerTool({ projectRoot: root });
    const runner = new ToolRunner({ registry: new ToolRegistry([entry]), workDir, pdp: allowPdp });
    const result = await runner.run('test.run', { command: [process.execPath, '--version'] });
    assert.equal(result.status, 'ok');
    assert.match(fs.readFileSync(path.join(workDir, result.stdout_ref.path), 'utf8'), /^v\d+/);
    fs.rmSync(rootDir, { recursive: true, force: true });
  });
});
