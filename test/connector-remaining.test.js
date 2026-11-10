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

  it('F-M2-08: shell rejects -e/--eval/-p/-c eval forms (arg-schema)', async () => {
    const calls = [];
    const shell = createShellConnector({
      commands: { node: 'node', bash: 'bash', sh: 'sh' },
      run: async (file, args) => { calls.push([file, args]); return { code: 0, stdout: '', stderr: '' }; },
    });
    for (const [id, argv] of [
      ['node', ['-e', 'process.exit(0)']],
      ['node', ['--eval', '1']],
      ['node', ['-p', '1']],
      ['node', ['--print', '1']],
      ['bash', ['-c', 'echo hi']],
      ['sh', ['--command=echo hi']],
      ['node', ['--eval=1']],
    ]) {
      const r = await shell.execute(id, argv);
      assert.equal(r.ok, false, argv.join(' '));
      assert.equal(r.error.code, 'SHELL_EVAL_DENIED', argv.join(' '));
    }
    assert.equal(calls.length, 0);
    assert.equal((await shell.execute('node', ['-v'])).ok, true);
    assert.deepEqual(calls, [['node', ['-v']]]);
  });

  it('F-M2-08: real git worktree add/remove round-trip', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-021b-real-wt-'));
    const repo = path.join(parent, 'repo');
    fs.mkdirSync(repo);
    const gitInit = require('node:child_process').spawnSync;
    const run = (args, cwd = repo) => {
      const r = gitInit('git', args, { cwd, encoding: 'utf8' });
      assert.equal(r.status, 0, `${args.join(' ')}\n${r.stderr}`);
    };
    run(['init', '-b', 'main']);
    run(['config', 'user.email', 'test@example.com']);
    run(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(repo, 'README.md'), 'wt\n');
    run(['add', 'README.md']);
    run(['commit', '-m', 'init']);

    const git = createGitConnector({ root: repo }); // real runProcess, no mock
    const added = await git.worktreeAdd('child-1', { parent: path.join(parent, 'trees') });
    assert.equal(added.ok, true, JSON.stringify(added));
    assert.ok(fs.existsSync(path.join(added.data.path, 'README.md')));
    const removed = await git.worktreeRemove(added.data.path);
    assert.equal(removed.ok, true, JSON.stringify(removed));
    assert.equal(fs.existsSync(added.data.path), false);
    fs.rmSync(parent, { recursive: true, force: true });
  });

  it('F-M2-08: CI fixtures match ApprovalService evaluateCheck on the same runs', async () => {
    const { evaluateCheck, latestRunByName } = require('../scripts/lib/github/approval-service.cjs');
    const fixtures = {
      pass: [{ name: 'test (22)', status: 'completed', conclusion: 'success', id: 1 }],
      fail: [{ name: 'test (22)', status: 'completed', conclusion: 'failure', id: 2 }],
      pending: [{ name: 'test (22)', status: 'in_progress', id: 3 }],
      missing: [],
    };
    const ci = createCiConnector({ checkRuns: fixtures });
    for (const [sha, expected] of [
      ['pass', 'pass'],
      ['fail', 'fail'],
      ['pending', 'pending'],
      ['missing', 'missing'],
    ]) {
      const status = await ci.status(sha);
      assert.equal(status.data.state, expected);
      const byName = latestRunByName(fixtures[sha]);
      const as = evaluateCheck('test (22)', byName, []);
      assert.equal(as.state, expected, sha);
    }
    // fromFixture parity with ApprovalService status-string mapping
    assert.equal(ci.fromFixture('x', { state: 'success' }), 'pass');
    assert.equal(ci.fromFixture('x', { state: 'failure' }), 'fail');
    assert.equal(ci.fromFixture('x', { state: 'pending' }), 'pending');
  });

  it('F-M2-08: connector journal records are redacted and no network for docs', async () => {
    const records = [];
    const journal = { record: (row) => records.push(row) };
    const token = 'ghp_abcdefghijklmnopqrstuvwx';
    const shell = createShellConnector({
      commands: { echo: 'echo' },
      journal,
      run: async () => ({ code: 0, stdout: 'ok', stderr: '' }),
    });
    assert.equal((await shell.execute('echo', [`token=${token}`])).ok, true);
    assert.equal(records.length, 1);
    assert.equal(records[0].connector, 'shell');
    assert.ok(!String(records[0].argv).includes(token));
    assert.match(JSON.stringify(records[0].argv), /\[REDACTED\]/);

    const git = createGitConnector({
      journal,
      run: async () => ({ code: 0, stdout: 'main', stderr: '' }),
    });
    assert.equal((await git.branch()).ok, true);
    assert.ok(records.some((r) => r.connector === 'git' && r.operation === 'branch'));

    const docs = createDocsConnector({
      root: fs.mkdtempSync(path.join(os.tmpdir(), 'ae-021b-j-')),
      allowedHosts: ['docs.example.test'],
      journal,
      // no fetcher → network disabled
    });
    const denied = await docs.fetch('https://docs.example.test/secret?token=' + token);
    assert.equal(denied.error.code, 'DOCS_NETWORK_DISABLED');
    const fetchRec = records.filter((r) => r.connector === 'docs' && r.operation === 'fetch').at(-1);
    assert.ok(fetchRec);
    assert.equal(fetchRec.host, 'docs.example.test');
  });
});
