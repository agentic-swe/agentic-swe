'use strict';

/**
 * AE-039a / PD-62 C2 / ADR-017: org RBAC on PDP.
 * Disk bindings only; caller grants ignored; non-org path + PD-49 gate unchanged.
 * config/default-policy.json must remain byte-identical.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { evaluate } = require('../scripts/lib/policy/pdp.cjs');
const {
  evaluateOrgAccess,
  extractOrgScopedContext,
  loadBindings,
  validateBinding,
  RULE_ID_DENY,
  RULE_ID_ALLOW,
} = require('../scripts/lib/policy/org-rbac.cjs');
const { AUTHORIZATION_FILE } = require('../scripts/lib/policy/roles.cjs');

const packRoot = path.join(__dirname, '..');
const fixturePolicy = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'policy-runtime', 'policy.json'), 'utf8')
);
const DEFAULT_POLICY_PATH = path.join(packRoot, 'config', 'default-policy.json');
const DEFAULT_POLICY_SHA_BEFORE = crypto
  .createHash('sha256')
  .update(fs.readFileSync(DEFAULT_POLICY_PATH))
  .digest('hex');

function tmpRoot(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `awe-org-rbac-${name}-`));
}

function writeBinding(dir, name, binding) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), JSON.stringify(binding, null, 2) + '\n');
}

function baseBinding(overrides = {}) {
  return {
    schema_version: 1,
    tenant_id: 'pilot-1',
    principal: 'user:alice@example.com',
    actions: ['org.memory.read', 'Bash'],
    resource: { type: 'organization', id: 'acme' },
    ...overrides,
  };
}

describe('AE-039a org RBAC (PD-62 C2)', () => {
  it('schema: valid binding accepted; invalid rejected fail-closed', () => {
    assert.equal(validateBinding(baseBinding()).ok, true);
    assert.equal(validateBinding({ schema_version: 1 }).ok, false);
    assert.equal(
      validateBinding(baseBinding({ resource: { type: 'workspace', id: 'x' } })).ok,
      false
    );
  });

  it('missing binding denied', () => {
    const root = tmpRoot('missing');
    const bindingsDir = path.join(root, '.agentic-swe', 'org-rbac');
    fs.mkdirSync(bindingsDir, { recursive: true });

    const d = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      tenant_id: 'pilot-1',
      org_id: 'acme',
      principal: 'user:alice@example.com',
      action: 'org.memory.read',
      orgRbacDir: bindingsDir,
    });
    assert.equal(d.decision, 'deny');
    assert.equal(d.rule_id, RULE_ID_DENY);
    assert.equal(d.code, 'ORG_RBAC_DENY');

    const direct = evaluateOrgAccess({
      tenantId: 'pilot-1',
      resource: { type: 'organization', id: 'acme' },
      principal: 'user:alice@example.com',
      action: 'org.memory.read',
      bindingsDir,
    });
    assert.equal(direct.decision, 'deny');
    assert.equal(direct.rule_id, RULE_ID_DENY);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('valid binding allowed through the existing PDP path', () => {
    const root = tmpRoot('allow');
    const bindingsDir = path.join(root, '.agentic-swe', 'org-rbac');
    writeBinding(bindingsDir, 'alice-acme.json', baseBinding());

    const d = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      tenant_id: 'pilot-1',
      org_id: 'acme',
      principal: 'user:alice@example.com',
      action: 'Bash',
      orgRbacDir: bindingsDir,
    });
    assert.equal(d.decision, 'allow');
    assert.equal(d.rule_id, 'pdp.allow');
    assert.equal(d.code, undefined);

    const direct = evaluateOrgAccess({
      tenantId: 'pilot-1',
      resource: { type: 'organization', id: 'acme' },
      principal: 'user:alice@example.com',
      action: 'org.memory.read',
      bindingsDir,
    });
    assert.equal(direct.decision, 'allow');
    assert.equal(direct.rule_id, RULE_ID_ALLOW);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('cross-tenant binding does not authorize (deny)', () => {
    const root = tmpRoot('xtenant');
    const bindingsDir = path.join(root, '.agentic-swe', 'org-rbac');
    writeBinding(
      bindingsDir,
      'other-tenant.json',
      baseBinding({ tenant_id: 'other-tenant' })
    );

    const d = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      tenant_id: 'pilot-1',
      org_id: 'acme',
      principal: 'user:alice@example.com',
      action: 'Bash',
      orgRbacDir: bindingsDir,
    });
    assert.equal(d.decision, 'deny');
    assert.equal(d.rule_id, RULE_ID_DENY);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('caller-supplied grants cannot elevate org access', () => {
    const root = tmpRoot('elevate');
    const bindingsDir = path.join(root, '.agentic-swe', 'org-rbac');
    fs.mkdirSync(bindingsDir, { recursive: true });
    // No binding for bob — only spoofed caller grants.

    const d = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      tenant_id: 'pilot-1',
      org_id: 'acme',
      principal: 'user:bob@example.com',
      action: 'org.memory.read',
      orgRbacDir: bindingsDir,
      authorized: new Set(['org.memory.read', 'org.admin', 'github.pr.write']),
      flags: {
        org_authorized: true,
        authorized: true,
        humanAuthorized: true,
        org_rbac_bypass: true,
      },
      org_grants: [{ action: 'org.memory.read', principal: 'user:bob@example.com' }],
      grants: ['org.memory.read'],
    });
    assert.equal(d.decision, 'deny');
    assert.equal(d.rule_id, RULE_ID_DENY);
    assert.equal(d.code, 'ORG_RBAC_DENY');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('non-org tool call unchanged (no org context → skip check)', () => {
    const before = extractOrgScopedContext({
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
    });
    assert.equal(before, null);

    const d = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      state: 'design',
    });
    assert.equal(d.decision, 'allow');
    assert.equal(d.rule_id, 'pdp.allow');
    assert.notEqual(d.rule_id, RULE_ID_DENY);

    // tenant alone without org/team/project is not org-scoped.
    const tenantOnly = extractOrgScopedContext({
      tenant_id: 'pilot-1',
      principal: 'user:alice@example.com',
      action: 'Bash',
    });
    assert.equal(tenantOnly, null);

    const d2 = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      tenant_id: 'pilot-1',
      principal: 'user:alice@example.com',
    });
    assert.equal(d2.decision, 'allow');
    assert.equal(d2.rule_id, 'pdp.allow');
  });

  it('self-improvement merge still denied without a user: authorization record (PD-49)', () => {
    const root = tmpRoot('si');
    const workDir = path.join(root, '.worklogs', 'si-item');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({
        work_id: 'si-item',
        current_state: 'implementation',
        mode: 'self-improvement',
        pipeline: { track: 'rigorous' },
        history: [],
      })
    );
    // Org binding present — must not bypass the PD-49 self-improvement gate.
    const bindingsDir = path.join(root, '.agentic-swe', 'org-rbac');
    writeBinding(
      bindingsDir,
      'si.json',
      baseBinding({
        principal: 'user:alice@example.com',
        actions: ['github.merge', 'Bash'],
      })
    );

    const d = evaluate({
      policy: fixturePolicy,
      mode: 'self-improvement',
      workDir,
      toolName: 'github.merge',
      toolInput: { pull_number: 1 },
      tenant_id: 'pilot-1',
      org_id: 'acme',
      principal: 'user:alice@example.com',
      action: 'github.merge',
      orgRbacDir: bindingsDir,
      authorized: new Set(['github.pr.write', 'github.merge']),
    });
    assert.equal(d.decision, 'deny');
    assert.equal(d.rule_id, 'section15.self_improvement_merge_deploy');
    assert.equal(d.code, 'SECTION15_DENY');

    // Still denied when no org context (pure PD-49 path).
    const plain = evaluate({
      policy: fixturePolicy,
      mode: 'self-improvement',
      workDir,
      toolName: 'github.merge',
      toolInput: { pull_number: 1 },
    });
    assert.equal(plain.decision, 'deny');
    assert.equal(plain.rule_id, 'section15.self_improvement_merge_deploy');

    // Confirm user: disk auth still yields require_approval on the SI path.
    fs.writeFileSync(
      path.join(workDir, AUTHORIZATION_FILE),
      JSON.stringify({
        grants: [
          {
            action: 'github.pr.write',
            actor: 'user:founder@example.com',
            at: '2026-11-14T00:00:00.000Z',
          },
        ],
        revoked: [],
      })
    );
    const withAuth = evaluate({
      policy: fixturePolicy,
      mode: 'self-improvement',
      workDir,
      toolName: 'github.merge',
      toolInput: { protected: true, pull_number: 1 },
    });
    assert.equal(withAuth.decision, 'require_approval');
    assert.equal(withAuth.rule_id, 'section15.self_improvement_merge_deploy');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('invalid binding files never grant; default-policy.json byte-identical', () => {
    const root = tmpRoot('invalid');
    const bindingsDir = path.join(root, '.agentic-swe', 'org-rbac');
    writeBinding(bindingsDir, 'bad.json', { schema_version: 1, tenant_id: 'pilot-1' });
    writeBinding(bindingsDir, 'not-json.json', 'not-json{{{');

    const loaded = loadBindings(bindingsDir);
    assert.equal(loaded.bindings.length, 0);
    assert.ok(loaded.errors.length >= 1);

    const d = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      tenant_id: 'pilot-1',
      org_id: 'acme',
      principal: 'user:alice@example.com',
      action: 'Bash',
      orgRbacDir: bindingsDir,
    });
    assert.equal(d.decision, 'deny');
    assert.equal(d.rule_id, RULE_ID_DENY);

    const shaAfter = crypto
      .createHash('sha256')
      .update(fs.readFileSync(DEFAULT_POLICY_PATH))
      .digest('hex');
    assert.equal(shaAfter, DEFAULT_POLICY_SHA_BEFORE);

    // Agent role files untouched by this item (spot-check hypervisor still present).
    const hypervisor = path.join(packRoot, 'config', 'roles', 'hypervisor.json');
    assert.equal(fs.existsSync(hypervisor), true);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('team_id and project_id resource types match bindings', () => {
    const root = tmpRoot('team-proj');
    const bindingsDir = path.join(root, '.agentic-swe', 'org-rbac');
    writeBinding(
      bindingsDir,
      'team.json',
      baseBinding({
        resource: { type: 'team', id: 'platform' },
        actions: ['org.memory.read'],
      })
    );
    writeBinding(
      bindingsDir,
      'proj.json',
      baseBinding({
        principal: 'user:carol@example.com',
        resource: { type: 'project', id: 'alpha' },
        actions: ['org.memory.write'],
      })
    );

    const teamOk = evaluate({
      policy: fixturePolicy,
      toolName: 'Read',
      toolInput: { file_path: 'x' },
      tenant_id: 'pilot-1',
      team_id: 'platform',
      principal: 'user:alice@example.com',
      action: 'org.memory.read',
      orgRbacDir: bindingsDir,
    });
    assert.equal(teamOk.decision, 'allow');

    const projDeny = evaluate({
      policy: fixturePolicy,
      toolName: 'Read',
      toolInput: { file_path: 'x' },
      tenant_id: 'pilot-1',
      project_id: 'alpha',
      principal: 'user:alice@example.com',
      action: 'org.memory.write',
      orgRbacDir: bindingsDir,
    });
    assert.equal(projDeny.decision, 'deny');

    const projOk = evaluate({
      policy: fixturePolicy,
      toolName: 'Read',
      toolInput: { file_path: 'x' },
      tenant_id: 'pilot-1',
      project_id: 'alpha',
      principal: 'user:carol@example.com',
      action: 'org.memory.write',
      orgRbacDir: bindingsDir,
    });
    assert.equal(projOk.decision, 'allow');

    fs.rmSync(root, { recursive: true, force: true });
  });
});
