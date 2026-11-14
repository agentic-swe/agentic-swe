'use strict';

/**
 * AE-039d: integration permission grants from org RBAC bindings only.
 * Caller-supplied grants ignored; binding grants enforced.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveIntegrationGrants,
  callerIntegrationGrantKey,
} = require('../scripts/lib/policy/integration-grants.cjs');
const { createInMemoryVault } = require('../scripts/lib/connectors/vault.cjs');
const { createFixtureConnector } = require('../scripts/lib/connectors/fixture-connector.cjs');
const { createConnectorRuntime } = require('../scripts/lib/connectors/framework.cjs');

function tmpBindings() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ae039d-'));
  const bindingsDir = path.join(root, '.agentic-swe', 'org-rbac');
  fs.mkdirSync(bindingsDir, { recursive: true });
  return { root, bindingsDir };
}

function writeBinding(bindingsDir, name, binding) {
  fs.writeFileSync(path.join(bindingsDir, name), JSON.stringify(binding, null, 2) + '\n');
}

describe('AE-039d integration permission grants', () => {
  it('caller-supplied integration grant ignored', async () => {
    const { root, bindingsDir } = tmpBindings();
    // No binding for the principal — caller authorized must not elevate.
    const vault = createInMemoryVault();
    const runtime = createConnectorRuntime({ vault, bindingsDir, projectRoot: root });
    runtime.register(
      createFixtureConnector({
        id: 'fixture.echo',
        required_permissions: ['connector.fixture.read'],
        data_by_tenant: { tenantA: { records: ['x'] } },
      })
    );
    vault.put({
      tenant_id: 'tenantA',
      connector_id: 'fixture.echo',
      secret: 'vault-secret',
    });

    assert.equal(callerIntegrationGrantKey({ authorized: ['connector.fixture.read'] }), 'authorized');

    const denied = await runtime.invoke({
      connector_id: 'fixture.echo',
      tenant_id: 'tenantA',
      org_id: 'orgA',
      principal: 'user:spoof@example.com',
      // Spoofed elevation — must be ignored.
      authorized: ['connector.fixture.read', 'admin'],
      grants: ['connector.fixture.read'],
      permissions: ['connector.fixture.read'],
      input: {},
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, 'PERMISSION_DENIED');

    const resolved = resolveIntegrationGrants({
      tenantId: 'tenantA',
      orgId: 'orgA',
      principal: 'user:spoof@example.com',
      bindingsDir,
      // Spoofed params must not matter:
      authorized: ['connector.fixture.read'],
      grants: ['connector.fixture.read'],
    });
    assert.equal(resolved.ok, false);
    assert.equal(resolved.grants.size, 0);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('binding grant enforced', async () => {
    const { root, bindingsDir } = tmpBindings();
    writeBinding(bindingsDir, 'alice.json', {
      schema_version: 1,
      tenant_id: 'tenantA',
      principal: 'user:alice@example.com',
      actions: ['connector.fixture.read'],
      resource: { type: 'organization', id: 'orgA' },
    });

    const vault = createInMemoryVault();
    const runtime = createConnectorRuntime({ vault, bindingsDir, projectRoot: root });
    runtime.register(
      createFixtureConnector({
        id: 'fixture.echo',
        required_permissions: ['connector.fixture.read'],
        data_by_tenant: { tenantA: { records: ['bound-ok'] } },
      })
    );
    vault.put({
      tenant_id: 'tenantA',
      connector_id: 'fixture.echo',
      secret: 'vault-secret',
    });

    const resolved = resolveIntegrationGrants({
      tenantId: 'tenantA',
      orgId: 'orgA',
      principal: 'user:alice@example.com',
      bindingsDir,
    });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.grants.has('connector.fixture.read'), true);

    const ok = await runtime.invoke({
      connector_id: 'fixture.echo',
      tenant_id: 'tenantA',
      org_id: 'orgA',
      principal: 'user:alice@example.com',
      input: {},
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.data.records, ['bound-ok']);

    // Wrong principal still denied even with same org.
    const wrong = await runtime.invoke({
      connector_id: 'fixture.echo',
      tenant_id: 'tenantA',
      org_id: 'orgA',
      principal: 'user:eve@example.com',
      authorized: ['connector.fixture.read'],
      input: {},
    });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.error.code, 'PERMISSION_DENIED');

    fs.rmSync(root, { recursive: true, force: true });
  });
});
