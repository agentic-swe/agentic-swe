'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createGitConnector, createShellConnector, createCiConnector, createDocsConnector,
  createRemainingTools, ToolRegistry, ToolRunner, callerGrantInjection,
} = require('../scripts/lib/tools/index.cjs');
const { privilegedActions } = require('../scripts/lib/policy/roles.cjs');

const allowPdp = {
  evaluate: () => ({
    decision: 'allow', rule_id: 'test.allow', policy_digest: 'a'.repeat(64), risk_class: 'low', reason: 'test',
  }),
};

describe('AE-021b connectors', () => {
  it('1: shell accepts only allow-listed command ids and safe argv', async () => {
    const calls = [];
    const shell = createShellConnector({
      commands: { echo: 'echo' },
      run: async (file, args) => { calls.push([file, args]); return { code: 0, stdout: 'ok', stderr: '' }; },
    });
    assert.equal((await shell.execute('missing', [])).error.code, 'SHELL_COMMAND_DENIED');
    assert.equal((await shell.execute('echo', ['ok; touch hacked'])).error.code, 'SHELL_METACHARACTER_DENIED');
    assert.equal((await shell.execute('echo', ['ok'])).data.stdout, 'ok');
    assert.deepEqual(calls, [['echo', ['ok']]]);
  });

  it('2: git push requires a grant and refuses protected refs even with one', async () => {
    const calls = [];
    const git = createGitConnector({
      run: async (file, args) => { calls.push([file, args]); return { code: 0, stdout: '', stderr: '' }; },
    });
    assert.equal((await git.push({ branch: 'feature/x' })).error.code, 'DENIED_UNAUTHORIZED');
    assert.equal((await git.push({ branch: 'main' }, { authorized: new Set(['github.branch.push']) })).error.code, 'PROTECTED_REF');
    assert.equal((await git.push({ branch: 'feature/x' }, { authorized: new Set(['github.branch.push']) })).ok, true);
    assert.deepEqual(calls, [['git', ['push', 'origin', 'HEAD:refs/heads/feature/x']]]);
  });

  it('2b: F-M2-01 caller-supplied authorized on git.local never spawns git push', async () => {
    const calls = [];
    const tools = createRemainingTools({
      run: async (file, args) => { calls.push([file, ...args]); return { code: 0, stdout: '', stderr: '' }; },
    });
    const runner = new ToolRunner({ registry: new ToolRegistry(tools), pdp: allowPdp });
    // Exact adversarial payload from M2 exit audit — previously pushed with allow PDP.
    const bypass = await runner.run('git.local', {
      operation: 'push',
      args: [{ branch: 'feature/x' }, { authorized: ['github.branch.push'] }],
    });
    assert.equal(bypass.status, 'denied');
    assert.equal(bypass.error.code, 'DENIED_UNAUTHORIZED');
    assert.equal(calls.length, 0, 'git process must not spawn on injected grant');

    const injectedLocal = await runner.run('git.local', {
      operation: 'status',
      authorized: ['github.branch.push'],
    });
    assert.equal(injectedLocal.status, 'denied');
    assert.equal(calls.length, 0);

    const pushTool = tools.find((t) => t.manifest.id === 'git.push');
    assert.ok(pushTool);
    assert.deepEqual(pushTool.manifest.permissions, ['github.branch.push']);
    assert.equal(pushTool.manifest.side_effects, 'remote');

    const noGrant = await runner.run('git.push', { branch: 'feature/x' });
    assert.equal(noGrant.status, 'error');
    assert.equal(noGrant.error.code, 'DENIED_UNAUTHORIZED');
    assert.equal(calls.length, 0);

    const granted = await runner.run('git.push', { branch: 'feature/x' }, {
      authorized: new Set(['github.branch.push']),
    });
    assert.equal(granted.status, 'ok');
    assert.deepEqual(calls, [['git', 'push', 'origin', 'HEAD:refs/heads/feature/x']]);

    assert.equal(callerGrantInjection({ authorized: ['x'] }), 'authorized');
    assert.equal(callerGrantInjection({ args: [{ grants: [] }] }), 'grants');
    assert.deepEqual(privilegedActions('git.push', {}), ['github.branch.push']);
    assert.deepEqual(privilegedActions('git.local', { operation: 'push' }), ['github.branch.push']);
  });

  it('3: creates and removes one child worktree with argv-only git', async () => {
    const calls = [];
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-021b-'));
    const git = createGitConnector({
      root: parent,
      run: async (file, args) => { calls.push(args); return { code: 0, stdout: '', stderr: '' }; },
    });
    const added = await git.worktreeAdd('child-1', { parent });
    assert.equal(added.ok, true);
    assert.equal(added.data.path, path.join(parent, 'child-1'));
    assert.equal((await git.worktreeRemove(added.data.path)).ok, true);
    assert.deepEqual(calls.map((args) => args[0]), ['worktree', 'worktree']);
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('4: CI fixtures normalize pass, fail, pending, and missing', async () => {
    const ci = createCiConnector({
      checkRuns: {
        pass: [{ name: 'test (22)', status: 'completed', conclusion: 'success' }],
        fail: [{ name: 'test (22)', status: 'completed', conclusion: 'failure' }],
        pending: [{ name: 'test (22)', status: 'in_progress' }],
      },
    });
    assert.equal((await ci.status('pass')).data.state, 'pass');
    assert.equal((await ci.status('fail')).data.state, 'fail');
    assert.equal((await ci.status('pending')).data.state, 'pending');
    assert.equal((await ci.status('missing')).data.state, 'missing');
    assert.equal(ci.fromFixture('sha', { sha: 'sha', state: 'success' }), 'pass');
  });

  it('5: docs allow repository files and deny non-allow-listed hosts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-021b-docs-'));
    fs.writeFileSync(path.join(root, 'README.md'), 'fixture');
    const docs = createDocsConnector({ root, allowedHosts: ['docs.example.test'] });
    assert.equal((await docs.readFile('README.md')).data, 'fixture');
    assert.equal((await docs.fetch('https://evil.example.test/a')).error.code, 'DOCS_HOST_DENIED');
    assert.equal((await docs.fetch('https://docs.example.test/a')).error.code, 'DOCS_NETWORK_DISABLED');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
