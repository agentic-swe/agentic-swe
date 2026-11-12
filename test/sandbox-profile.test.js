'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SANDBOX_PROFILES,
  resolveSandboxProfile,
  buildSandboxEnv,
  assertSandboxArgv,
  assertSandboxNetwork,
  assertSandboxFsWrite,
  prepareSandboxSpawn,
  spawnSandboxed,
  fetchUnderSandbox,
  ToolRegistry,
  ToolRunner,
  createTestRunnerTool,
  callerGrantInjection,
} = require('../scripts/lib/tools/index.cjs');

const allowDecision = {
  decision: 'allow',
  rule_id: 'test.allow',
  policy_digest: 'a'.repeat(64),
  risk_class: 'low',
  reason: 'test allow',
};
const denyDecision = {
  decision: 'deny',
  rule_id: 'test.deny',
  policy_digest: 'b'.repeat(64),
  risk_class: 'high',
  reason: 'denied by policy',
  code: 'POLICY_DENIED',
};
const allowPdp = { evaluate: () => ({ ...allowDecision }) };
const denyPdp = { evaluate: () => ({ ...denyDecision }) };

function work() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-profile-'));
  const workDir = path.join(rootDir, '.worklogs', 'item');
  fs.mkdirSync(workDir, { recursive: true });
  return { rootDir, workDir };
}

describe('AE-027a process sandbox profiles (PD-31)', () => {
  it('exposes named plugin-untrusted / process-default profiles without touching baseline policy files', () => {
    assert.ok(SANDBOX_PROFILES['plugin-untrusted']);
    assert.equal(SANDBOX_PROFILES['plugin-untrusted'].network, 'deny');
    assert.equal(SANDBOX_PROFILES['plugin-untrusted'].shell, false);
    assert.equal(SANDBOX_PROFILES['plugin-untrusted'].require_pdp_allow, true);
    const resolved = resolveSandboxProfile('plugin-untrusted');
    assert.equal(resolved.ok, true);
    assert.equal(resolved.profile.id, 'plugin-untrusted');
    const unknown = resolveSandboxProfile('container-vm');
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, 'SANDBOX_PROFILE_UNKNOWN');
    // Additive: default-policy.json must remain the baseline file on disk.
    const policyPath = path.join(__dirname, '..', 'config', 'default-policy.json');
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    assert.equal(policy.version, '1.0');
    assert.ok(Array.isArray(policy.banned_commands));
  });

  it('AC1: sandboxed child env does not contain planted GITHUB_TOKEN / NPM_TOKEN from parent', async () => {
    const prevGh = process.env.GITHUB_TOKEN;
    const prevNpm = process.env.NPM_TOKEN;
    process.env.GITHUB_TOKEN = 'ghp_planted_should_not_leak';
    process.env.NPM_TOKEN = 'npm_planted_should_not_leak';
    try {
      const resolved = resolveSandboxProfile('plugin-untrusted');
      assert.equal(resolved.ok, true);
      const { profile } = resolved;
      const env = buildSandboxEnv(profile, {
        GITHUB_TOKEN: 'caller_injected_token',
        NPM_TOKEN: 'caller_injected_npm',
        SAFE_FLAG: '1',
      });
      assert.equal(env.GITHUB_TOKEN, undefined);
      assert.equal(env.NPM_TOKEN, undefined);
      assert.equal(env.CI, '1');
      assert.ok(env.PATH);
      // SAFE_FLAG is dropped when env_allowlist is null (extras only via explicit allowlist).
      assert.equal(env.SAFE_FLAG, undefined);

      const withAllow = resolveSandboxProfile({
        profile: 'plugin-untrusted',
        env: ['SAFE_FLAG', 'GITHUB_TOKEN'],
      });
      const allowedEnv = buildSandboxEnv(withAllow.profile, {
        SAFE_FLAG: '1',
        GITHUB_TOKEN: 'still_blocked',
        OTHER: 'no',
      });
      assert.equal(allowedEnv.SAFE_FLAG, '1');
      assert.equal(allowedEnv.GITHUB_TOKEN, undefined);
      assert.equal(allowedEnv.OTHER, undefined);

      let seenEnv = null;
      let spawnCount = 0;
      const result = await spawnSandboxed(profile, process.execPath, ['--version'], {
        decision: allowDecision,
        spawn: (file, args, opts) => {
          spawnCount += 1;
          seenEnv = opts.env;
          // Minimal EventEmitter-like stub.
          const { EventEmitter } = require('node:events');
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          queueMicrotask(() => {
            child.stdout.emit('data', 'v22\n');
            child.emit('close', 0, null);
          });
          return child;
        },
      });
      assert.equal(result.ok, true);
      assert.equal(spawnCount, 1);
      assert.ok(seenEnv);
      assert.equal(seenEnv.GITHUB_TOKEN, undefined);
      assert.equal(seenEnv.NPM_TOKEN, undefined);
      assert.equal(seenEnv.CI, '1');
    } finally {
      if (prevGh === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = prevGh;
      if (prevNpm === undefined) delete process.env.NPM_TOKEN;
      else process.env.NPM_TOKEN = prevNpm;
    }
  });

  it('AC1b: blank/null env extra keys are skipped; secret-shaped names never pass', () => {
    const { profile } = resolveSandboxProfile('plugin-untrusted');
    const env = buildSandboxEnv(profile, {
      FOO: null,
      BAR: undefined,
      MY_SECRET: 'x',
      ACCESS_KEY: 'y',
      '': 'bad',
    });
    assert.equal(env.FOO, undefined);
    assert.equal(env.BAR, undefined);
    assert.equal(env.MY_SECRET, undefined);
    assert.equal(env.ACCESS_KEY, undefined);
  });

  it('AC2: shell:true and shell-meta argv are rejected', () => {
    assert.equal(assertSandboxArgv({ shell: true, argv: ['echo', 'hi'] }).code, 'SANDBOX_SHELL_DENIED');
    assert.equal(assertSandboxArgv({ argv: 'echo hi; rm -rf /' }).code, 'SANDBOX_SHELL_META');
    assert.equal(assertSandboxArgv({ argv: ['echo', 'ok; touch x'] }).code, 'SANDBOX_SHELL_META');
    const ok = assertSandboxArgv({ argv: [process.execPath, '--version'] });
    assert.equal(ok.ok, true);
    assert.equal(ok.file, process.execPath);

    const { profile } = resolveSandboxProfile('plugin-untrusted');
    const denied = prepareSandboxSpawn(profile, {
      command: ['echo', 'a|b'],
      decision: allowDecision,
      shell: false,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'SANDBOX_SHELL_META');
    assert.equal(denied.spawned, false);

    const shellTrue = prepareSandboxSpawn(profile, {
      file: 'echo',
      args: ['hi'],
      decision: allowDecision,
      shell: true,
    });
    assert.equal(shellTrue.code, 'SANDBOX_SHELL_DENIED');
  });

  it('AC3: network fetch without injected allow-listed transport fails closed', async () => {
    const { profile } = resolveSandboxProfile('plugin-untrusted');
    assert.equal(assertSandboxNetwork(profile, 'https://evil.example/beacon').code, 'SANDBOX_NETWORK_DENIED');

    const allowlisted = resolveSandboxProfile({
      profile: 'plugin-untrusted',
      net_hosts: ['docs.example.test'],
    });
    assert.equal(allowlisted.ok, true);
    assert.equal(allowlisted.profile.network, 'allowlist');
    const noTransport = assertSandboxNetwork(allowlisted.profile, 'https://docs.example.test/a');
    assert.equal(noTransport.code, 'SANDBOX_NETWORK_DISABLED');

    const fetched = await fetchUnderSandbox(allowlisted.profile, 'https://docs.example.test/a', {
      transport: async () => ({ body: 'ok' }),
    });
    assert.equal(fetched.ok, true);
    assert.deepEqual(fetched.data, { body: 'ok' });

    const otherHost = await fetchUnderSandbox(allowlisted.profile, 'https://evil.example/x', {
      transport: async () => ({ body: 'nope' }),
    });
    assert.equal(otherHost.ok, false);
    assert.equal(otherHost.error.code, 'SANDBOX_HOST_DENIED');
  });

  it('AC4: caller-supplied authorized/permissions in tool input still denied (F-M2-01 regression)', async () => {
    const { rootDir, workDir } = work();
    let calls = 0;
    const entry = createTestRunnerTool({ projectRoot: rootDir });
    const runner = new ToolRunner({
      registry: new ToolRegistry([entry]),
      workDir,
      pdp: allowPdp,
    });
    const injected = await runner.run('test.run', {
      command: [process.execPath, '--version'],
      authorized: ['proc.exec:arbitrary-code'],
      permissions: ['net:evil'],
    });
    assert.equal(injected.status, 'denied');
    assert.equal(injected.error.code, 'DENIED_UNAUTHORIZED');
    assert.equal(calls, 0);
    assert.equal(callerGrantInjection({ authorized: true }), 'authorized');
    assert.equal(callerGrantInjection({ permissions: [] }), 'permissions');
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('AC5: policy deny → zero spawn (spy)', async () => {
    const { profile } = resolveSandboxProfile('plugin-untrusted');
    let spawnCount = 0;
    const denied = await spawnSandboxed(profile, process.execPath, ['--version'], {
      decision: denyDecision,
      spawn: () => {
        spawnCount += 1;
        throw new Error('spawn must not be called');
      },
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.spawned, false);
    assert.equal(denied.code, 'POLICY_DENIED');
    assert.equal(spawnCount, 0);

    const missing = await spawnSandboxed(profile, process.execPath, ['--version'], {
      spawn: () => {
        spawnCount += 1;
        throw new Error('spawn must not be called');
      },
    });
    assert.equal(missing.spawned, false);
    assert.equal(missing.code, 'SANDBOX_POLICY_REQUIRED');
    assert.equal(spawnCount, 0);

    // Runner path: deny PDP never reaches execute/spawn.
    const { rootDir, workDir } = work();
    let executeCalls = 0;
    const registry = new ToolRegistry([{
      manifest: {
        id: 'fixture.spawn',
        version: '1.0.0',
        permissions: [],
        input_schema: { type: 'object' },
        side_effects: 'local',
        idempotency: 'idempotent',
        timeout_ms: 1000,
        sandbox: { profile: 'plugin-untrusted' },
      },
      execute: async () => {
        executeCalls += 1;
        return { status: 'ok' };
      },
    }]);
    const result = await new ToolRunner({ registry, workDir, pdp: denyPdp }).run('fixture.spawn', {});
    assert.equal(result.status, 'denied');
    assert.equal(executeCalls, 0);
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('fs.write allow-list fails closed on escape / empty list / integrity paths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-fs-'));
    try {
      const { profile } = resolveSandboxProfile({
        profile: 'plugin-untrusted',
        cwd_root: root,
        fs_write: ['out/**'],
      });
      assert.equal(assertSandboxFsWrite(profile, '../escape.txt').code, 'SANDBOX_FS_DENIED');
      assert.equal(assertSandboxFsWrite(profile, 'out/ok.txt').ok, true);
      assert.equal(assertSandboxFsWrite(profile, '.worklogs/x/journal.jsonl').code, 'SANDBOX_FS_DENIED');
      const empty = resolveSandboxProfile({ profile: 'plugin-untrusted', cwd_root: root, fs_write: [] });
      assert.equal(assertSandboxFsWrite(empty.profile, 'out/ok.txt').code, 'SANDBOX_FS_DENIED');
      const noRoot = resolveSandboxProfile('plugin-untrusted');
      assert.equal(assertSandboxFsWrite(noRoot.profile, 'x').code, 'SANDBOX_FS_ROOT_REQUIRED');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('test.run under ToolRunner uses sandbox env (no parent secrets) and requires allow', async () => {
    const prev = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'ghp_runner_path_secret';
    const { rootDir, workDir } = work();
    try {
      const entry = createTestRunnerTool({ projectRoot: rootDir });
      const runner = new ToolRunner({
        registry: new ToolRegistry([entry]),
        workDir,
        pdp: allowPdp,
      });
      const result = await runner.run('test.run', { command: [process.execPath, '--version'] });
      assert.equal(result.status, 'ok', result.error && result.error.message);
      assert.match(fs.readFileSync(path.join(workDir, result.stdout_ref.path), 'utf8'), /^v\d+/);

      // Direct execute without decision must not spawn.
      let spawnHits = 0;
      const denied = await entry.execute(
        { command: [process.execPath, '--version'] },
        {
          manifest: entry.manifest,
          decision: null,
        }
      );
      assert.equal(denied.status, 'denied');
      assert.equal(denied.spawned, false);
      assert.equal(spawnHits, 0);
    } finally {
      if (prev === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = prev;
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('corrupt/blank profile id fails closed', () => {
    assert.equal(resolveSandboxProfile('').ok, false);
    assert.equal(resolveSandboxProfile(null).ok, true); // defaults to plugin-untrusted
    assert.equal(resolveSandboxProfile({ profile: '   ' }).profile.id, 'plugin-untrusted');
    const prep = prepareSandboxSpawn(null, { file: 'echo', args: ['x'], decision: allowDecision });
    assert.equal(prep.code, 'SANDBOX_PROFILE_REQUIRED');
  });
});
