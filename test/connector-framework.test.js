'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInMemoryVault } = require('../scripts/lib/connectors/vault.cjs');
const { createFixtureConnector } = require('../scripts/lib/connectors/fixture-connector.cjs');
const { createConnectorRuntime } = require('../scripts/lib/connectors/framework.cjs');

function writeBinding(dir, name, binding) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(binding, null, 2) + '\n');
}

function buildRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ae040a-conn-'));
  const bindingsDir = path.join(root, '.agentic-swe', 'org-rbac');
  writeBinding(bindingsDir, 'tenantA.json', {
    schema_version: 1,
    tenant_id: 'tenantA',
    principal: 'user:alice@example.com',
    actions: ['connector.fixture.read'],
    resource: { type: 'organization', id: 'orgA' },
  });
  writeBinding(bindingsDir, 'tenantB.json', {
    schema_version: 1,
    tenant_id: 'tenantB',
    principal: 'user:bob@example.com',
    actions: ['connector.fixture.read'],
    resource: { type: 'organization', id: 'orgB' },
  });

  const publicMemorySink = { writes: [] };
  const vault = createInMemoryVault();
  const runtime = createConnectorRuntime({ vault, publicMemorySink, bindingsDir, projectRoot: root });
  const connector = createFixtureConnector({
    id: 'fixture.echo',
    required_permissions: ['connector.fixture.read'],
    data_by_tenant: {
      tenantA: { records: ['a-secret-record'], org: 'orgA' },
      tenantB: { records: ['b-private-record'], org: 'orgB' },
    },
    fail_tenants: {
      tenantA: undefined,
    },
  });
  const failing = createFixtureConnector({
    id: 'fixture.fail',
    required_permissions: ['connector.fixture.read'],
    data_by_tenant: {
      tenantA: { records: ['a-ok'] },
      tenantB: { records: ['b-ok'] },
    },
    fail_tenants: {
      tenantA: {
        code: 'SIMULATED_UPSTREAM',
        message: 'upstream boom token=ghp_LEAKTHISSECRETVALUE999999',
        leak: {
          other_tenant: 'tenantB',
          secret: 'super-secret-from-tenantA',
          tenantB_data: { records: ['b-private-record'] },
        },
      },
    },
  });
  runtime.register(connector);
  runtime.register(failing);
  vault.put({
    tenant_id: 'tenantA',
    connector_id: 'fixture.echo',
    secret: 'vault-secret-A-ghp_SHOULD_NOT_LOG',
    permissions: ['connector.fixture.read'],
  });
  vault.put({
    tenant_id: 'tenantB',
    connector_id: 'fixture.echo',
    secret: 'vault-secret-B-ghp_SHOULD_NOT_LOG',
    permissions: ['connector.fixture.read'],
  });
  vault.put({
    tenant_id: 'tenantA',
    connector_id: 'fixture.fail',
    secret: 'vault-secret-A-fail',
  });
  vault.put({
    tenant_id: 'tenantB',
    connector_id: 'fixture.fail',
    secret: 'vault-secret-B-fail',
  });
  return { runtime, publicMemorySink, vault, root, bindingsDir };
}

test('AE-040a: credential isolation — caller credentials and grants rejected; vault secrets not logged', async () => {
  const { runtime, publicMemorySink, root } = buildRuntime();

  const withToken = await runtime.invoke({
    connector_id: 'fixture.echo',
    tenant_id: 'tenantA',
    org_id: 'orgA',
    principal: 'user:alice@example.com',
    input: { token: 'caller-supplied-token-SHOULD-REJECT' },
  });
  assert.equal(withToken.ok, false);
  assert.equal(withToken.error.code, 'CALLER_CREDENTIAL_REJECTED');
  assert.match(JSON.stringify(withToken), /not accepted/);
  assert.doesNotMatch(JSON.stringify(withToken), /caller-supplied-token-SHOULD-REJECT/);

  const withGrant = await runtime.invoke({
    connector_id: 'fixture.echo',
    tenant_id: 'tenantA',
    org_id: 'orgA',
    principal: 'user:alice@example.com',
    input: { grants: ['connector.fixture.read', 'admin'] },
  });
  assert.equal(withGrant.ok, false);
  assert.equal(withGrant.error.code, 'CALLER_GRANT_REJECTED');

  const ok = await runtime.invoke({
    connector_id: 'fixture.echo',
    tenant_id: 'tenantA',
    org_id: 'orgA',
    principal: 'user:alice@example.com',
    input: { query: 'hello' },
  });
  assert.equal(ok.ok, true);
  const serialized = JSON.stringify(ok);
  assert.doesNotMatch(serialized, /vault-secret-A/);
  assert.doesNotMatch(serialized, /ghp_SHOULD_NOT_LOG/);
  assert.equal(publicMemorySink.writes.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('AE-040a: failure isolation — tenant A failure does not leak into tenant B or public memory', async () => {
  const { runtime, publicMemorySink, root } = buildRuntime();

  const failA = await runtime.invoke({
    connector_id: 'fixture.fail',
    tenant_id: 'tenantA',
    org_id: 'orgA',
    principal: 'user:alice@example.com',
    input: {},
  });
  assert.equal(failA.ok, false);
  assert.equal(failA.error.code, 'SIMULATED_UPSTREAM');
  const failJson = JSON.stringify(failA);
  assert.doesNotMatch(failJson, /super-secret-from-tenantA/);
  assert.doesNotMatch(failJson, /b-private-record/);
  assert.doesNotMatch(failJson, /ghp_LEAKTHISSECRETVALUE/);
  assert.equal(publicMemorySink.writes.length, 0);

  const okB = await runtime.invoke({
    connector_id: 'fixture.fail',
    tenant_id: 'tenantB',
    org_id: 'orgB',
    principal: 'user:bob@example.com',
    input: {},
  });
  assert.equal(okB.ok, true);
  assert.deepEqual(okB.data.records, ['b-ok']);
  assert.doesNotMatch(JSON.stringify(okB), /a-ok|super-secret|tenantA/);
  assert.equal(publicMemorySink.writes.length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('AE-040a/AE-039d: least privilege — binding grants enforced; caller authorized ignored', async () => {
  const { runtime, root } = buildRuntime();

  const denied = await runtime.invoke({
    connector_id: 'fixture.echo',
    tenant_id: 'tenantA',
    org_id: 'orgA',
    principal: 'user:nobody@example.com',
    authorized: ['connector.fixture.read'],
    input: {},
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'PERMISSION_DENIED');

  const allowed = await runtime.invoke({
    connector_id: 'fixture.echo',
    tenant_id: 'tenantA',
    org_id: 'orgA',
    principal: 'user:alice@example.com',
    input: {},
  });
  assert.equal(allowed.ok, true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('AE-040a: boundary — cross-org resource access denied; missing credential is isolated', async () => {
  const { runtime, vault, publicMemorySink, root } = buildRuntime();

  const crossOrg = await runtime.invoke({
    connector_id: 'fixture.echo',
    tenant_id: 'tenantA',
    org_id: 'orgA',
    principal: 'user:alice@example.com',
    resource: { tenant_id: 'tenantA', org_id: 'orgB' },
    action: 'read',
    input: {},
  });
  assert.equal(crossOrg.ok, false);
  assert.match(crossOrg.error.code, /ORG|TENANT|ACCESS|DENIED|MISMATCH/i);

  const crossTenant = await runtime.invoke({
    connector_id: 'fixture.echo',
    tenant_id: 'tenantA',
    org_id: 'orgA',
    principal: 'user:alice@example.com',
    resource: { tenant_id: 'tenantB', org_id: 'orgB' },
    action: 'read',
    input: {},
  });
  assert.equal(crossTenant.ok, false);

  vault.clearTenant('tenantA');
  const missingCred = await runtime.invoke({
    connector_id: 'fixture.echo',
    tenant_id: 'tenantA',
    org_id: 'orgA',
    principal: 'user:alice@example.com',
    input: {},
  });
  assert.equal(missingCred.ok, false);
  assert.equal(missingCred.error.code, 'CREDENTIAL_MISSING');
  assert.equal(publicMemorySink.writes.length, 0);

  const stillB = await runtime.invoke({
    connector_id: 'fixture.echo',
    tenant_id: 'tenantB',
    org_id: 'orgB',
    principal: 'user:bob@example.com',
    input: {},
  });
  assert.equal(stillB.ok, true);
  assert.deepEqual(stillB.data.records, ['b-private-record']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('AE-040a: fixture connectors are in-process only (no network flag)', () => {
  const c = createFixtureConnector({
    id: 'fixture.meta',
    required_permissions: [],
    data_by_tenant: { t: {} },
  });
  assert.equal(c.kind, 'fixture');
  assert.equal(c.network, false);
});
