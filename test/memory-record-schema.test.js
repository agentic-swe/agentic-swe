'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// eslint-disable-next-line import/no-extraneous-dependencies
const Ajv = require('ajv/dist/2020').default;

const {
  MEMORY_SCOPES,
  LEGACY_CLI_SCOPES,
  LEGACY_CLI_SCOPE_TO_MEMORY_SCOPE,
  RETENTION_CLASS_DEFAULTS,
  DEFAULT_TENANT_ID,
  DEFAULT_TRUST,
  mapLegacyCliScope,
  mapLegacyWorkId,
  defaultRetentionClassForScope,
} = require('../scripts/lib/memory/taxonomy.cjs');
const scopes = require('../scripts/lib/memory/scopes.cjs');

const root = path.join(__dirname, '..');
const fixtureDir = path.join(__dirname, 'fixtures', 'memory-record');
const schemaPath = path.join(root, 'schemas', 'memory-record.schema.json');

function loadSchema() {
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

function compileValidator() {
  // format keywords (date-time) are annotations only — no ajv-formats dependency.
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(loadSchema());
}

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

describe('AE-030a MemoryRecord schema', () => {
  it('schema declares six scopes, tenant_id/trust defaults, and PD-47 retention classes', () => {
    const schema = loadSchema();
    assert.deepEqual(schema.properties.scope.enum, [...MEMORY_SCOPES]);
    assert.equal(schema.properties.tenant_id.default, 'personal');
    assert.equal(schema.properties.trust.default, 'untrusted');
    assert.deepEqual(schema.properties.retention_class.enum, [
      'session',
      'execution_procedures',
      'organizational',
      'evaluation_negative',
    ]);
    assert.deepEqual(schema.properties.provenance.required, [
      'origin',
      'actor',
      'source_hash',
      'ingested_at',
    ]);
    assert.equal(DEFAULT_TENANT_ID, 'personal');
    assert.equal(DEFAULT_TRUST, 'untrusted');
    assert.equal(RETENTION_CLASS_DEFAULTS.session.ttl_days, 90);
    assert.equal(RETENTION_CLASS_DEFAULTS.execution_procedures.ttl_days, 180);
    assert.equal(RETENTION_CLASS_DEFAULTS.organizational.ttl_days, 365);
    assert.equal(RETENTION_CLASS_DEFAULTS.evaluation_negative.ttl_days, null);
  });

  it('fixture validates all six scopes', () => {
    const validate = compileValidator();
    for (const scope of MEMORY_SCOPES) {
      const data = readFixture(`valid-${scope}.json`);
      assert.equal(data.scope, scope);
      const ok = validate(data);
      assert.ok(ok, `${scope}: ${JSON.stringify(validate.errors, null, 2)}`);
    }
  });

  it('unknown scope fails with named path /scope', () => {
    const validate = compileValidator();
    const data = readFixture('invalid-unknown-scope.json');
    assert.equal(validate(data), false);
    assert.ok(Array.isArray(validate.errors) && validate.errors.length > 0);
    const scopeErr = validate.errors.find(
      (e) => e.instancePath === '/scope' || e.instancePath === '#/scope'
    );
    assert.ok(
      scopeErr,
      `expected error on /scope, got ${JSON.stringify(validate.errors, null, 2)}`
    );
    assert.match(scopeErr.instancePath, /scope/);
  });

  it('missing provenance.actor fails closed on named path', () => {
    const validate = compileValidator();
    const data = readFixture('valid-execution.json');
    delete data.provenance.actor;
    assert.equal(validate(data), false);
    const err = validate.errors.find(
      (e) =>
        (e.instancePath === '/provenance' || e.instancePath === '') &&
        (e.params?.missingProperty === 'actor' || String(e.message || '').includes('actor'))
    );
    assert.ok(
      err || validate.errors.some((e) => String(e.instancePath).includes('provenance')),
      JSON.stringify(validate.errors, null, 2)
    );
  });
});

describe('AE-030a legacy scope / work_id map', () => {
  it('maps each legacy CLI scope to a MemoryRecord scope', () => {
    assert.deepEqual(LEGACY_CLI_SCOPES, ['session', 'personal', 'team']);
    assert.equal(mapLegacyCliScope('session'), 'execution');
    assert.equal(mapLegacyCliScope('personal'), 'skill');
    assert.equal(mapLegacyCliScope('team'), 'organizational');
    assert.deepEqual(LEGACY_CLI_SCOPE_TO_MEMORY_SCOPE, {
      session: 'execution',
      personal: 'skill',
      team: 'organizational',
    });
  });

  it('maps each legacy work_id pattern to a MemoryRecord scope', () => {
    const cases = [
      [null, 'repository'],
      [undefined, 'repository'],
      ['', 'repository'],
      ['   ', 'repository'],
      ['personal', 'skill'],
      ['team', 'organizational'],
      ['session', 'execution'],
      ['session:abc123', 'execution'],
      ['work:ae-030a', 'execution'],
      ['ae-030a', 'project'],
      ['dogfood-item', 'project'],
    ];
    for (const [workId, expected] of cases) {
      assert.equal(
        mapLegacyWorkId(workId),
        expected,
        `work_id=${JSON.stringify(workId)} → ${expected}`
      );
    }
  });

  it('unknown legacy CLI scope fails with named path', () => {
    assert.throws(
      () => mapLegacyCliScope('fleet'),
      (err) =>
        err instanceof Error &&
        err.code === 'UNKNOWN_LEGACY_SCOPE' &&
        err.path === 'legacy_scope'
    );
    assert.throws(() => mapLegacyCliScope(''), (err) => err.path === 'legacy_scope');
  });

  it('defaultRetentionClassForScope covers PD-47 rows', () => {
    assert.equal(defaultRetentionClassForScope('execution'), 'session');
    assert.equal(defaultRetentionClassForScope('organizational'), 'organizational');
    assert.equal(
      defaultRetentionClassForScope('evaluation', { negativeEval: true }),
      'evaluation_negative'
    );
    assert.equal(defaultRetentionClassForScope('repository'), 'session');
    assert.equal(defaultRetentionClassForScope('project'), 'session');
    assert.equal(defaultRetentionClassForScope('skill'), 'session');
  });

  it('scopes.cjs re-exports taxonomy without changing sqlitePathForScope', () => {
    assert.equal(scopes.mapLegacyCliScope('session'), 'execution');
    assert.equal(scopes.mapLegacyWorkId('personal'), 'skill');
    assert.deepEqual(scopes.MEMORY_SCOPES, MEMORY_SCOPES);
    assert.equal(typeof scopes.personalRoot, 'function');
    assert.equal(typeof scopes.sqlitePathForScope, 'function');
  });

  it('mapping table is documented in memory-graph.md', () => {
    const doc = fs.readFileSync(path.join(root, 'docs', 'specs', 'memory-graph.md'), 'utf8');
    assert.match(doc, /S8a — MemoryRecord six-type taxonomy/);
    assert.match(doc, /memory-record\.schema\.json/);
    for (const scope of MEMORY_SCOPES) {
      assert.match(doc, new RegExp(`\`${scope}\``));
    }
    assert.match(doc, /\| `session` \|/);
    assert.match(doc, /\| `personal` \|/);
    assert.match(doc, /\| `team` \|/);
    assert.match(doc, /tenant_id.*personal/i);
  });
});
