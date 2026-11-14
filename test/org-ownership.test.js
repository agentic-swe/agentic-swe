'use strict';

/**
 * AE-036a — org/team/project/user/role/workspace ownership schema.
 * Acceptance: fixtures validate; ownership required; unknown type / unknown owner fail closed.
 * Refs ADR-017 A3 / C1.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// eslint-disable-next-line import/no-extraneous-dependencies
const Ajv = require('ajv/dist/2020').default;

const {
  RESOURCE_TYPES,
  OWNER_KINDS,
  assertKnownResourceType,
  validateOrgResource,
  hasExplicitOwnership,
  indexKnownOwners,
} = require('../scripts/lib/memory/org-ownership.cjs');
const {
  loadTenantConfig,
  resolvePilotTenantId,
  tenantConfigPath,
} = require('../scripts/lib/memory/tenant-config.cjs');

const root = path.join(__dirname, '..');
const fixtureDir = path.join(__dirname, 'fixtures', 'org-resource');
const schemaPath = path.join(root, 'schemas', 'org-resource.schema.json');

function loadSchema() {
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

function compileValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(loadSchema());
}

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

/** Seed catalog covering every owner referenced by valid fixtures. */
function seedKnownOwners() {
  return indexKnownOwners([
    { kind: 'user', id: 'user:founder' },
    { kind: 'organization', id: 'org:acme' },
    { kind: 'team', id: 'team:platform' },
    { kind: 'project', id: 'project:autoeng' },
  ]);
}

describe('AE-036a org resource ownership schema', () => {
  it('schema declares six resource types and required ownership', () => {
    const schema = loadSchema();
    assert.deepEqual(schema.properties.type.enum, [...RESOURCE_TYPES]);
    assert.ok(schema.required.includes('owner'));
    assert.ok(schema.required.includes('tenant_id'));
    assert.ok(schema.required.includes('type'));
    assert.deepEqual(schema.properties.owner.required, ['kind', 'id']);
    assert.deepEqual(schema.properties.owner.properties.kind.enum, [...OWNER_KINDS]);
  });

  it('fixtures validate organization/team/project/user/role/workspace with explicit ownership', () => {
    const validate = compileValidator();
    const ownerRefs = [
      { kind: 'user', id: 'user:founder' },
      { kind: 'organization', id: 'org:acme' },
      { kind: 'team', id: 'team:platform' },
      { kind: 'project', id: 'project:autoeng' },
    ];
    assert.equal(seedKnownOwners().size, ownerRefs.length);

    for (const type of RESOURCE_TYPES) {
      const data = readFixture(`valid-${type}.json`);
      assert.equal(data.type, type);
      assert.ok(hasExplicitOwnership(data), `${type} must have explicit ownership`);
      const ok = validate(data);
      assert.ok(ok, `${type}: ${JSON.stringify(validate.errors, null, 2)}`);
      const parsed = validateOrgResource(data, { knownOwners: ownerRefs });
      assert.equal(parsed.type, type);
      assert.ok(parsed.owner.kind);
      assert.ok(parsed.owner.id);
      assert.equal(parsed.tenant_id, 'pilot-acme');
    }
  });

  it('unknown resource type fails closed (schema + runtime)', () => {
    const validate = compileValidator();
    const data = readFixture('invalid-unknown-type.json');
    assert.equal(validate(data), false);
    const typeErr = validate.errors.find(
      (e) => e.instancePath === '/type' || String(e.instancePath || '').endsWith('/type')
    );
    assert.ok(typeErr, `expected /type error, got ${JSON.stringify(validate.errors)}`);

    assert.throws(
      () => assertKnownResourceType('galaxy'),
      (err) => err && err.code === 'UNKNOWN_RESOURCE_TYPE'
    );
    assert.throws(
      () =>
        validateOrgResource(data, {
          knownOwners: [{ kind: 'user', id: 'user:founder' }],
        }),
      (err) => err && err.code === 'UNKNOWN_RESOURCE_TYPE'
    );
  });

  it('missing ownership fails closed', () => {
    const validate = compileValidator();
    const data = readFixture('invalid-missing-owner.json');
    assert.equal(validate(data), false);
    assert.equal(hasExplicitOwnership(data), false);
    assert.throws(
      () =>
        validateOrgResource(data, {
          knownOwners: [{ kind: 'user', id: 'user:founder' }],
        }),
      (err) => err && err.code === 'MISSING_OWNERSHIP'
    );
  });

  it('unknown owner fails closed', () => {
    const data = readFixture('valid-organization.json');
    // Catalog does not include user:founder → fail closed
    assert.throws(
      () =>
        validateOrgResource(data, {
          knownOwners: [{ kind: 'user', id: 'user:someone-else' }],
        }),
      (err) => err && err.code === 'UNKNOWN_OWNER' && /user:founder/.test(err.message)
    );
    // Empty catalog also fails closed
    assert.throws(
      () => validateOrgResource(data, { knownOwners: [] }),
      (err) => err && err.code === 'UNKNOWN_OWNER'
    );
  });

  it('blank owner id fails closed as missing ownership', () => {
    const data = {
      ...readFixture('valid-user.json'),
      owner: { kind: 'organization', id: '   ' },
    };
    assert.throws(
      () =>
        validateOrgResource(data, {
          knownOwners: [{ kind: 'organization', id: 'org:acme' }],
        }),
      (err) => err && err.code === 'MISSING_OWNERSHIP'
    );
  });
});

describe('AE-036a tenant config (ADR-017 C1)', () => {
  it('loads human-written tenant_id from .agentic-swe/tenant.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae036a-tenant-'));
    try {
      const cfgDir = path.join(dir, '.agentic-swe');
      fs.mkdirSync(cfgDir, { recursive: true });
      fs.copyFileSync(
        path.join(fixtureDir, 'tenant-opt-in.json'),
        path.join(cfgDir, 'tenant.json')
      );
      const cfg = loadTenantConfig(dir);
      assert.equal(cfg.tenant_id, 'pilot-acme');
      assert.equal(cfg.share_org_memory, false);
      assert.equal(resolvePilotTenantId(dir), 'pilot-acme');
      assert.equal(tenantConfigPath(dir), path.join(dir, '.agentic-swe', 'tenant.json'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('absent tenant config returns null (PD-46 local-private default)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae036a-noten-'));
    try {
      assert.equal(loadTenantConfig(dir), null);
      assert.equal(resolvePilotTenantId(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('caller cannot assert a broader/different tenant than config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae036a-mismatch-'));
    try {
      const cfgDir = path.join(dir, '.agentic-swe');
      fs.mkdirSync(cfgDir, { recursive: true });
      fs.writeFileSync(
        path.join(cfgDir, 'tenant.json'),
        JSON.stringify({ tenant_id: 'pilot-acme' }),
        'utf8'
      );
      assert.throws(
        () => resolvePilotTenantId(dir, { callerTenantId: 'other-tenant' }),
        (err) => err && err.code === 'TENANT_MISMATCH'
      );
      assert.equal(resolvePilotTenantId(dir, { callerTenantId: 'pilot-acme' }), 'pilot-acme');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
