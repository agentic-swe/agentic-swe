'use strict';

/**
 * AE-030d — retention/TTL dry-run, delete+tombstone, incremental delete, private→public.
 * Refs ADR-012 A5–A6, PD-46, PD-47.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pluginRoot = path.resolve(__dirname, '..');
const {
  createMemoryService,
  ttlDryRun,
  evaluateExpiry,
  defaultVisibilityForScope,
  resolveTenantLabel,
} = require('../scripts/lib/memory/memory-service.cjs');
const {
  RETENTION_CLASS_DEFAULTS,
  defaultRetentionClassForScope,
} = require('../scripts/lib/memory/taxonomy.cjs');
const { ttlDaysForRetentionClass } = require('../scripts/lib/memory/memory-retention.cjs');
const { runIncrementalIndex } = require('../scripts/lib/memory/incremental-index.cjs');
const { openOrCreateDatabase, closeDatabase } = require('../scripts/lib/memory/graph-store.cjs');
const {
  publishSkill,
  assertMemorySourcePublishAllowed,
} = require('../scripts/lib/skills/skill-registry.cjs');

function makeProvenance(origin, ingestedAt) {
  return {
    origin,
    actor: 'user:test',
    source_hash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    ingested_at: ingestedAt || '2020-01-01T00:00:00.000Z',
  };
}

describe('AE-030d retention / delete / visibility', () => {
  let tmp;
  let personal;
  let prevPersonal;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-030d-'));
    personal = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-030d-personal-'));
    prevPersonal = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = personal;
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'ae-030d-fixture', version: '1.0.0' })
    );
  });

  after(() => {
    if (prevPersonal === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
    else process.env.AGENTIC_SWE_PERSONAL_ROOT = prevPersonal;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(personal, { recursive: true, force: true });
  });

  it('PD-47 TTL defaults: session 90d, procedures 180d, org 1y, eval negatives indefinite', () => {
    assert.equal(RETENTION_CLASS_DEFAULTS.session.ttl_days, 90);
    assert.equal(RETENTION_CLASS_DEFAULTS.execution_procedures.ttl_days, 180);
    assert.equal(RETENTION_CLASS_DEFAULTS.organizational.ttl_days, 365);
    assert.equal(RETENTION_CLASS_DEFAULTS.evaluation_negative.ttl_days, null);
  });

  it('execution scope defaults to 180d execution_procedures class (PD-47)', () => {
    assert.equal(defaultRetentionClassForScope('execution'), 'execution_procedures');
    assert.equal(ttlDaysForRetentionClass(defaultRetentionClassForScope('execution')), 180);
    const rec = {
      id: 'mem:exec:default-ttl',
      scope: 'execution',
      retention_class: defaultRetentionClassForScope('execution'),
      provenance: makeProvenance('t', '2026-01-01T00:00:00.000Z'),
      body: 'procedure',
    };
    const mid = evaluateExpiry(rec, Date.parse('2026-04-01T00:00:00.000Z')); // ~90d later
    assert.equal(mid.expired, false);
    assert.equal(mid.ttlDays, 180);
    const late = evaluateExpiry(rec, Date.parse('2026-08-01T00:00:00.000Z')); // ~212d later
    assert.equal(late.expired, true);
  });

  it('session retention class stays at 90d when callers set it explicitly', () => {
    assert.equal(ttlDaysForRetentionClass('session'), 90);
    const rec = {
      id: 'mem:session:explicit',
      scope: 'execution',
      retention_class: 'session',
      provenance: makeProvenance('t', '2026-01-01T00:00:00.000Z'),
      body: 'session note',
    };
    const at91d = evaluateExpiry(rec, Date.parse('2026-04-02T00:00:00.000Z'));
    assert.equal(at91d.ttlDays, 90);
    assert.equal(at91d.expired, true);
  });

  it('TTL dry-run reports expired ids without network', () => {
    const records = [
      {
        id: 'mem:old-session',
        scope: 'execution',
        retention_class: 'session',
        provenance: makeProvenance('t', '2020-01-01T00:00:00.000Z'),
        body: 'old',
      },
      {
        id: 'mem:eval-neg',
        scope: 'evaluation',
        retention_class: 'evaluation_negative',
        provenance: makeProvenance('t', '2019-01-01T00:00:00.000Z'),
        body: 'keep forever',
      },
      {
        id: 'mem:fresh',
        scope: 'organizational',
        retention_class: 'organizational',
        provenance: makeProvenance('t', new Date().toISOString()),
        body: 'fresh',
      },
    ];
    const report = ttlDryRun(records, { now: '2026-11-13T00:00:00.000Z' });
    assert.equal(report.dry_run, true);
    assert.ok(report.expired_ids.includes('mem:old-session'));
    assert.ok(!report.expired_ids.includes('mem:eval-neg'));
    assert.ok(!report.expired_ids.includes('mem:fresh'));
    assert.ok(evaluateExpiry(records[1]).expired === false);
  });

  it('delete-then-prime/read misses deleted ids', async () => {
    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      await svc.write({
        id: 'mem:org:keep',
        scope: 'organizational',
        body: 'KEEP_030D_UNIQUE',
        provenance: makeProvenance('write'),
      });
      await svc.write({
        id: 'mem:org:drop',
        scope: 'organizational',
        body: 'DROP_030D_UNIQUE',
        provenance: makeProvenance('write'),
      });
      const before = await svc.read({ scope: 'organizational', query: '030D_UNIQUE' });
      assert.equal(before.records.length, 2);

      const deleted = await svc.delete({ id: 'mem:org:drop', scope: 'organizational' });
      assert.ok(deleted.deleted.includes('mem:org:drop'));

      const after = await svc.read({ scope: 'organizational', query: '030D_UNIQUE' });
      assert.equal(after.records.length, 1);
      assert.equal(after.records[0].id, 'mem:org:keep');
      assert.ok(!after.records.some((r) => r.id === 'mem:org:drop'));
      assert.ok(!after.envelopes.some((e) => e.citation.id === 'mem:org:drop'));
    } finally {
      await svc.close();
    }
  });

  it('incremental index removes watermark+chunks for deleted files', async () => {
    const docs = path.join(tmp, 'docs');
    fs.mkdirSync(docs, { recursive: true });
    const rel = 'docs/ae-030d-tracked.md';
    const abs = path.join(tmp, rel);
    fs.writeFileSync(abs, '# tracked\nUNIQUE_030D_INC_BODY\n');

    const first = await runIncrementalIndex({ projectRoot: tmp, pluginRoot, limit: 50 });
    assert.ok(first.updated >= 1);
    const wmPath = path.join(tmp, '.agentic-swe', 'index-watermark.json');
    assert.ok(fs.existsSync(wmPath));
    let wm = JSON.parse(fs.readFileSync(wmPath, 'utf8'));
    assert.ok(wm.files[rel]);

    const { db } = await openOrCreateDatabase(first.sqlitePath);
    try {
      const stmt = db.prepare(
        "SELECT COUNT(*) AS c FROM chunks WHERE path = ? AND body LIKE '%UNIQUE_030D_INC_BODY%'"
      );
      stmt.bind([rel]);
      assert.equal(stmt.step(), true);
      assert.ok(Number(stmt.getAsObject().c) >= 1);
      stmt.free();
    } finally {
      closeDatabase(db);
    }

    fs.rmSync(abs);
    const second = await runIncrementalIndex({ projectRoot: tmp, pluginRoot, limit: 50 });
    assert.ok(second.deleted >= 1);
    assert.ok(second.deletedPaths.includes(rel));
    wm = JSON.parse(fs.readFileSync(wmPath, 'utf8'));
    assert.equal(wm.files[rel], undefined);

    const again = await openOrCreateDatabase(first.sqlitePath);
    try {
      const stmt = again.db.prepare('SELECT COUNT(*) AS c FROM chunks WHERE path = ?');
      stmt.bind([rel]);
      assert.equal(stmt.step(), true);
      assert.equal(Number(stmt.getAsObject().c), 0);
      stmt.free();
    } finally {
      closeDatabase(again.db);
    }
  });

  it('org memory defaults private/local tenant; personal skill gets tenant label (PD-46)', async () => {
    assert.equal(defaultVisibilityForScope('organizational'), 'private');
    assert.equal(resolveTenantLabel('organizational', null, 'personal'), 'local');
    assert.equal(resolveTenantLabel('skill', null, 'personal'), 'personal');
    assert.equal(resolveTenantLabel('skill', 'tenant-x', 'personal'), 'tenant-x');

    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      const org = await svc.write({
        id: 'mem:org:vis',
        scope: 'organizational',
        body: 'org private default',
        provenance: makeProvenance('vis'),
      });
      assert.equal(org.visibility, 'private');
      assert.equal(org.tenant_id, 'local');

      await assert.rejects(
        () =>
          svc.write({
            id: 'mem:org:pub',
            scope: 'organizational',
            body: 'nope',
            visibility: 'public',
            provenance: makeProvenance('vis'),
          }),
        (err) => err && err.code === 'ORG_MEMORY_PUBLIC_FORBIDDEN'
      );

      const skill = await svc.write({
        id: 'mem:skill:vis',
        scope: 'skill',
        body: 'personal skill',
        tenant_id: 'tenant-acme',
        provenance: makeProvenance('vis'),
      });
      assert.equal(skill.tenant_id, 'tenant-acme');
    } finally {
      await svc.close();
    }
  });

  it('MemoryService retentionDryRun wires TTL without network', async () => {
    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      await svc.write({
        id: 'mem:org:ttl-old',
        scope: 'organizational',
        body: 'old org',
        retention_class: 'organizational',
        provenance: makeProvenance('ttl', '2015-01-01T00:00:00.000Z'),
      });
      const report = await svc.retentionDryRun({
        scope: 'organizational',
        now: '2026-11-13T00:00:00.000Z',
      });
      assert.equal(report.dry_run, true);
      assert.ok(report.expired_ids.includes('mem:org:ttl-old'));
    } finally {
      await svc.close();
    }
  });

  it('publish skill from organizational/private memory without governed path fails closed', () => {
    assert.throws(
      () =>
        assertMemorySourcePublishAllowed({
          memorySource: { scope: 'organizational', visibility: 'private' },
        }),
      (err) => err && err.code === 'PRIVATE_MEMORY_PUBLISH_FORBIDDEN'
    );

    const reg = path.join(tmp, 'reg-priv');
    fs.mkdirSync(reg, { recursive: true });
    // Minimal source dir is not needed: gate runs before install.
    const blocked = publishSkill({
      registryRoot: reg,
      sourceDir: path.join(tmp, 'missing-skill-src'),
      actor: 'user:test',
      memorySource: { scope: 'organizational', visibility: 'private' },
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'PRIVATE_MEMORY_PUBLISH_FORBIDDEN');

    // Governed path (approval_ref) allows the gate to pass; install may still fail later.
    assert.doesNotThrow(() =>
      assertMemorySourcePublishAllowed({
        memorySource: { scope: 'organizational', visibility: 'private' },
        approvalRef: 'pr:1',
      })
    );
  });

  it('omitted memorySource refused', () => {
    assert.throws(
      () => assertMemorySourcePublishAllowed({}),
      (err) => err && err.code === 'MEMORY_SOURCE_REQUIRED'
    );
    assert.throws(
      () => assertMemorySourcePublishAllowed({ memorySource: null }),
      (err) => err && err.code === 'MEMORY_SOURCE_REQUIRED'
    );
    const blocked = publishSkill({
      registryRoot: path.join(tmp, 'reg-omit'),
      sourceDir: path.join(tmp, 'missing-skill-src'),
      actor: 'user:test',
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'MEMORY_SOURCE_REQUIRED');
  });

  it('unknown memorySource value refused', () => {
    assert.throws(
      () => assertMemorySourcePublishAllowed({ memorySource: { kind: 'wat' } }),
      (err) => err && err.code === 'UNKNOWN_MEMORY_SOURCE'
    );
    assert.throws(
      () =>
        assertMemorySourcePublishAllowed({
          memorySource: { scope: 'not-a-scope', visibility: 'public' },
        }),
      (err) => err && err.code === 'UNKNOWN_MEMORY_SOURCE' && err.path === 'memorySource.scope'
    );
    assert.throws(
      () =>
        assertMemorySourcePublishAllowed({
          memorySource: { visibility: 'semi-public' },
        }),
      (err) =>
        err && err.code === 'UNKNOWN_MEMORY_SOURCE' && err.path === 'memorySource.visibility'
    );
    const blocked = publishSkill({
      registryRoot: path.join(tmp, 'reg-unknown'),
      sourceDir: path.join(tmp, 'missing-skill-src'),
      actor: 'user:test',
      memorySource: { declaration: 'mystery' },
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'UNKNOWN_MEMORY_SOURCE');
  });

  it('declared public-safe memorySource allowed', () => {
    assert.doesNotThrow(() =>
      assertMemorySourcePublishAllowed({
        memorySource: { publicSafe: true },
      })
    );
    assert.doesNotThrow(() =>
      assertMemorySourcePublishAllowed({
        memorySource: { declaration: 'public-safe' },
      })
    );
    assert.doesNotThrow(() =>
      assertMemorySourcePublishAllowed({
        memorySource: { declaration: 'first-party' },
      })
    );
    assert.doesNotThrow(() =>
      assertMemorySourcePublishAllowed({
        memorySource: { scope: 'skill', visibility: 'public' },
      })
    );
  });
});
