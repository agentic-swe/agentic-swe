'use strict';

/**
 * AE-039c: admin audit of org access decisions + retention surface.
 * Defaults: PD-47 organizational TTL = 365d. No network.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { evaluate } = require('../scripts/lib/policy/pdp.cjs');
const {
  appendOrgAccessAudit,
  listOrgAccessAudit,
  expireOrgAccessAudit,
  orgAccessAuditRetentionStatus,
  DEFAULT_TTL_DAYS,
  ADMIN_READ_ACTION,
  ADMIN_EXPIRE_ACTION,
  auditPath,
} = require('../scripts/lib/policy/org-access-audit.cjs');

const fixturePolicy = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'policy-runtime', 'policy.json'), 'utf8')
);

function tmpProject(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `awe-org-audit-${name}-`));
  const bindingsDir = path.join(root, '.agentic-swe', 'org-rbac');
  fs.mkdirSync(bindingsDir, { recursive: true });
  return { root, bindingsDir };
}

function writeBinding(bindingsDir, name, binding) {
  fs.writeFileSync(path.join(bindingsDir, name), JSON.stringify(binding, null, 2) + '\n');
}

describe('AE-039c org access audit + retention', () => {
  it('PDP appends org access decisions to the admin audit log', () => {
    const { root, bindingsDir } = tmpProject('pdp');
    writeBinding(bindingsDir, 'alice.json', {
      schema_version: 1,
      tenant_id: 'pilot-1',
      principal: 'user:alice@example.com',
      actions: ['Bash'],
      resource: { type: 'organization', id: 'acme' },
    });

    const allow = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      tenant_id: 'pilot-1',
      org_id: 'acme',
      principal: 'user:alice@example.com',
      action: 'Bash',
      orgRbacDir: bindingsDir,
      projectRoot: root,
    });
    assert.equal(allow.decision, 'allow');

    const deny = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      tenant_id: 'pilot-1',
      org_id: 'acme',
      principal: 'user:bob@example.com',
      action: 'Bash',
      orgRbacDir: bindingsDir,
      projectRoot: root,
    });
    assert.equal(deny.decision, 'deny');

    const raw = fs.readFileSync(auditPath(root), 'utf8');
    assert.match(raw, /"decision":"allow"/);
    assert.match(raw, /"decision":"deny"/);
    assert.match(raw, /user:alice@example\.com/);
    assert.ok(!raw.includes('password'), 'audit must not invent secrets');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('admin can list audit + retention status', () => {
    const { root, bindingsDir } = tmpProject('list');
    writeBinding(bindingsDir, 'admin.json', {
      schema_version: 1,
      tenant_id: 'pilot-1',
      principal: 'user:admin@example.com',
      actions: [ADMIN_READ_ACTION, ADMIN_EXPIRE_ACTION],
      resource: { type: 'organization', id: 'acme' },
    });
    appendOrgAccessAudit(root, {
      tenant_id: 'pilot-1',
      resource_type: 'organization',
      resource_id: 'acme',
      principal: 'user:alice@example.com',
      action: 'Bash',
      decision: 'allow',
      rule_id: 'org.rbac.allow',
    });

    const listed = listOrgAccessAudit({
      projectRoot: root,
      adminPrincipal: 'user:admin@example.com',
      tenantId: 'pilot-1',
      resource: { type: 'organization', id: 'acme' },
      bindingsDir,
    });
    assert.equal(listed.ok, true);
    assert.equal(listed.rows.length, 1);
    assert.equal(listed.retention.ttl_days, DEFAULT_TTL_DAYS);
    assert.equal(listed.retention.retention_class, 'organizational');
    assert.equal(listed.retention.count, 1);
    assert.match(listed.retention.source, /PD-47/);

    const status = orgAccessAuditRetentionStatus(root);
    assert.equal(status.ttl_days, 365);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('unauthorized admin → deny (no rows leaked)', () => {
    const { root, bindingsDir } = tmpProject('unauth');
    // Binding for alice read tools only — not audit admin.
    writeBinding(bindingsDir, 'alice.json', {
      schema_version: 1,
      tenant_id: 'pilot-1',
      principal: 'user:alice@example.com',
      actions: ['Bash'],
      resource: { type: 'organization', id: 'acme' },
    });
    appendOrgAccessAudit(root, {
      tenant_id: 'pilot-1',
      resource_type: 'organization',
      resource_id: 'acme',
      principal: 'user:secret@example.com',
      action: 'org.memory.read',
      decision: 'deny',
      rule_id: 'org.rbac.deny',
    });

    const listed = listOrgAccessAudit({
      projectRoot: root,
      adminPrincipal: 'user:alice@example.com',
      tenantId: 'pilot-1',
      resource: { type: 'organization', id: 'acme' },
      bindingsDir,
    });
    assert.equal(listed.ok, false);
    assert.equal(listed.code, 'ORG_AUDIT_ADMIN_DENIED');
    assert.deepEqual(listed.rows, []);

    const expired = expireOrgAccessAudit({
      projectRoot: root,
      adminPrincipal: 'user:alice@example.com',
      tenantId: 'pilot-1',
      resource: { type: 'organization', id: 'acme' },
      bindingsDir,
    });
    assert.equal(expired.ok, false);
    assert.equal(expired.code, 'ORG_AUDIT_ADMIN_DENIED');
    assert.equal(expired.removed, 0);
    // Row still present on disk.
    assert.equal(fs.readFileSync(auditPath(root), 'utf8').includes('secret@example.com'), true);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('expire drops rows older than PD-47 organizational TTL (365d)', () => {
    const { root, bindingsDir } = tmpProject('expire');
    writeBinding(bindingsDir, 'admin.json', {
      schema_version: 1,
      tenant_id: 'pilot-1',
      principal: 'user:admin@example.com',
      actions: [ADMIN_EXPIRE_ACTION, ADMIN_READ_ACTION],
      resource: { type: 'organization', id: 'acme' },
    });

    const old = appendOrgAccessAudit(root, {
      tenant_id: 'pilot-1',
      resource_type: 'organization',
      resource_id: 'acme',
      principal: 'user:old@example.com',
      action: 'Bash',
      decision: 'allow',
      rule_id: 'org.rbac.allow',
    });
    // Rewrite timestamp to 400 days ago.
    const rows = [old, appendOrgAccessAudit(root, {
      tenant_id: 'pilot-1',
      resource_type: 'organization',
      resource_id: 'acme',
      principal: 'user:new@example.com',
      action: 'Bash',
      decision: 'deny',
      rule_id: 'org.rbac.deny',
    })];
    rows[0].at = new Date(Date.now() - 400 * 86400000).toISOString();
    fs.writeFileSync(auditPath(root), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

    const result = expireOrgAccessAudit({
      projectRoot: root,
      adminPrincipal: 'user:admin@example.com',
      tenantId: 'pilot-1',
      resource: { type: 'organization', id: 'acme' },
      bindingsDir,
      ttlDays: DEFAULT_TTL_DAYS,
    });
    assert.equal(result.ok, true);
    assert.equal(result.removed, 1);
    assert.equal(result.remaining, 1);
    const listed = listOrgAccessAudit({
      projectRoot: root,
      adminPrincipal: 'user:admin@example.com',
      tenantId: 'pilot-1',
      resource: { type: 'organization', id: 'acme' },
      bindingsDir,
    });
    assert.equal(listed.rows.length, 1);
    assert.equal(listed.rows[0].principal, 'user:new@example.com');

    fs.rmSync(root, { recursive: true, force: true });
  });
});
