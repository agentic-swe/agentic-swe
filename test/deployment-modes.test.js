'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  MODES,
  PRIVATE_RUNNER_PROFILE,
  assertSelfHostedTenantIsolation,
  resolveSelfHostedTenantPath,
  filterPrivateRunnerEnv,
  assertPrivateRunnerNetwork,
  checkHybridRemote,
  managedControlPlaneStatus,
  modeCatalog,
} = require('../scripts/lib/deployment/modes.cjs');

test('AE-041a: mode catalog lists four modes with tested vs limit honesty', () => {
  assert.deepEqual([...MODES].sort(), ['hybrid', 'managed', 'private-runners', 'self-hosted']);
  const catalog = modeCatalog();
  for (const mode of MODES) {
    assert.ok(catalog[mode], mode);
    assert.ok(Array.isArray(catalog[mode].tested_in_repo));
    assert.ok(Array.isArray(catalog[mode].documented_limits));
    assert.ok(catalog[mode].documented_limits.length > 0);
  }
  assert.equal(catalog.managed.tested_in_repo.length, 0);
  assert.match(catalog.managed.note, /PD-62 C3/);
});

test('AE-041a: self-hosted tenant path isolation', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-041a-self-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const a = resolveSelfHostedTenantPath(root, 'tenantA');
  const b = resolveSelfHostedTenantPath(root, 'tenantB');
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.notEqual(a.path, b.path);
  assert.ok(a.path.includes(`${path.sep}tenants${path.sep}tenantA`));
  assert.ok(b.path.includes(`${path.sep}tenants${path.sep}tenantB`));

  const iso = assertSelfHostedTenantIsolation(root, 'tenantA', 'tenantB');
  assert.equal(iso.ok, true);

  const traversal = resolveSelfHostedTenantPath(root, '../escape');
  assert.equal(traversal.ok, false);
  assert.equal(traversal.code, 'INVALID_TENANT_ID');

  const blank = resolveSelfHostedTenantPath(root, '  ');
  assert.equal(blank.ok, false);
});

test('AE-041a: private-runner env allow-list', () => {
  assert.equal(PRIVATE_RUNNER_PROFILE.id, 'private-runner');
  assert.equal(PRIVATE_RUNNER_PROFILE.network, 'allowlist');
  assert.equal(PRIVATE_RUNNER_PROFILE.shell, false);

  const filtered = filterPrivateRunnerEnv({
    PATH: '/usr/bin',
    HOME: '/tmp/home',
    NODE_ENV: 'test',
    SECRET_TOKEN: 'should-deny',
    GITHUB_TOKEN: 'should-deny',
    EXTRA_LEAK: 'nope',
  });
  assert.deepEqual(Object.keys(filtered.env).sort(), ['HOME', 'NODE_ENV', 'PATH']);
  assert.ok(filtered.denied.includes('SECRET_TOKEN'));
  assert.ok(filtered.denied.includes('GITHUB_TOKEN'));
  assert.ok(filtered.denied.includes('EXTRA_LEAK'));
});

test('AE-041a: private-runner network allow-list', () => {
  assert.equal(assertPrivateRunnerNetwork('https://registry.npmjs.org/pkg').ok, true);
  assert.equal(assertPrivateRunnerNetwork('https://github.com/org/repo').ok, true);
  const denied = assertPrivateRunnerNetwork('https://evil.example/exfil');
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'NETWORK_HOST_DENIED');

  const blankProfile = assertPrivateRunnerNetwork('https://github.com', {
    network: 'deny',
    net_hosts: [],
  });
  assert.equal(blankProfile.ok, false);
});

test('AE-041a: hybrid fail-closed against stub remote', async () => {
  const absent = await checkHybridRemote({ remote: null, require_remote: true });
  assert.equal(absent.ok, false);
  assert.equal(absent.code, 'HYBRID_REMOTE_REQUIRED');

  const unreachable = await checkHybridRemote({
    require_remote: true,
    remote: {
      async ping() {
        throw new Error('ECONNREFUSED stub');
      },
    },
  });
  assert.equal(unreachable.ok, false);
  assert.equal(unreachable.code, 'HYBRID_REMOTE_UNREACHABLE');

  const denied = await checkHybridRemote({
    require_remote: true,
    remote: {
      async ping() {
        return { ok: false, code: 'REMOTE_DENY', message: 'nope' };
      },
    },
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'REMOTE_DENY');

  const ok = await checkHybridRemote({
    require_remote: true,
    remote: {
      async ping() {
        return { ok: true };
      },
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.mode, 'hybrid');
});

test('AE-041a: managed mode is documented limit only (no fake plane)', () => {
  const status = managedControlPlaneStatus();
  assert.equal(status.implemented, false);
  assert.equal(status.ok, false);
  assert.equal(status.code, 'MANAGED_PLANE_NOT_IMPLEMENTED');
  assert.deepEqual(status.tested_claims, []);
  assert.ok(status.documented_limits.length >= 2);
  // Docs artifact exists and states honesty rule.
  const doc = fs.readFileSync(
    path.join(__dirname, '..', 'docs', 'ops', 'deployment-modes.md'),
    'utf8',
  );
  assert.match(doc, /Do not invent a managed control plane/);
  assert.match(doc, /PD-62/);
  assert.match(doc, /\*\*Tested:\*\* \*nothing that claims managed isolation exists\.\*/);
});
