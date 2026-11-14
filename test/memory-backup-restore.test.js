'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  backupMemoryStore,
  restoreMemoryStore,
  tenantMemorySqlitePath,
  openTenantMemoryStore,
  durableExecutorStatus,
  defaultBackupPath,
} = require('../scripts/lib/memory/backup-restore.cjs');

function fixtureProvenance(tenantId) {
  return {
    origin: 'ae-041b-fixture',
    actor: 'test',
    source_hash: `sha256:${tenantId}`,
    ingested_at: '2026-11-14T00:00:00Z',
  };
}

async function seedTenant(storeRoot, tenantId, marker) {
  const { store, sqlitePath } = await openTenantMemoryStore(storeRoot, tenantId);
  try {
    await store.upsertChunk({
      chunkId: `${tenantId}-chunk-1`,
      path: `docs/${tenantId}.md`,
      workId: null,
      scope: 'organizational',
      body: marker,
      startLine: 1,
      endLine: 1,
      contentSha256: 'abc',
      recordJson: JSON.stringify({
        provenance: fixtureProvenance(tenantId),
        trust: 'observed',
        tenant_id: tenantId,
      }),
    });
    await store.persist();
  } finally {
    await store.close();
  }
  return sqlitePath;
}

async function listBodies(sqlitePath) {
  const { createNodeSqliteMemoryStore } = require('../scripts/lib/memory/adapters/node-sqlite-memory-store.cjs');
  const store = createNodeSqliteMemoryStore({ sqlitePath });
  await store.open();
  try {
    const rows = await store.listChunks({ limit: 100 });
    return rows.map((r) => r.body);
  } finally {
    await store.close();
  }
}

test('AE-041b: backup/restore fixture round-trip', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-041b-br-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const sqlitePath = await seedTenant(root, 'tenantA', 'marker-A-original');
  const { backupPath } = backupMemoryStore({ sqlitePath });
  assert.ok(fs.existsSync(backupPath));

  // Mutate live store after backup.
  const { store } = await openTenantMemoryStore(root, 'tenantA');
  try {
    await store.upsertChunk({
      chunkId: 'tenantA-chunk-2',
      path: 'docs/tenantA.md',
      workId: null,
      scope: 'organizational',
      body: 'marker-A-mutated',
      startLine: 2,
      endLine: 2,
      contentSha256: 'def',
      recordJson: JSON.stringify({
        provenance: fixtureProvenance('tenantA-mut'),
        trust: 'observed',
        tenant_id: 'tenantA',
      }),
    });
    await store.persist();
  } finally {
    await store.close();
  }
  const mutated = await listBodies(sqlitePath);
  assert.ok(mutated.includes('marker-A-mutated'));

  restoreMemoryStore({ sqlitePath, backupPath });
  const restored = await listBodies(sqlitePath);
  assert.ok(restored.includes('marker-A-original'));
  assert.ok(!restored.includes('marker-A-mutated'));
});

test('AE-041b: restore failure rolls back to pre-restore live file', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-041b-rb-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const sqlitePath = await seedTenant(root, 'tenantA', 'live-before-restore');
  const before = fs.readFileSync(sqlitePath);
  const backupPath = defaultBackupPath(sqlitePath);
  // Create a distinct backup so we are not restoring the same bytes.
  fs.copyFileSync(sqlitePath, backupPath);
  // Mutate live after backup copy.
  fs.writeFileSync(sqlitePath, Buffer.concat([before, Buffer.from('CORRUPT-TAIL')]));

  await assert.rejects(
    async () => restoreMemoryStore({ sqlitePath, backupPath, injectFailure: true }),
    (err) => err && err.code === 'RESTORE_FAILED' && err.rolled_back === true,
  );

  const after = fs.readFileSync(sqlitePath);
  assert.ok(after.equals(Buffer.concat([before, Buffer.from('CORRUPT-TAIL')])), 'live file rolled back to pre-restore');
  assert.ok(!fs.existsSync(`${sqlitePath}.pre-restore`));
});

test('AE-041b: tenant isolation — A backup restored in A is invisible to B', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-041b-iso-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const pathA = await seedTenant(root, 'tenantA', 'SECRET-FROM-A-ONLY');
  const pathB = await seedTenant(root, 'tenantB', 'data-from-B');
  assert.notEqual(pathA, pathB);
  assert.equal(pathA, tenantMemorySqlitePath(root, 'tenantA'));
  assert.equal(pathB, tenantMemorySqlitePath(root, 'tenantB'));

  const { backupPath } = backupMemoryStore({ sqlitePath: pathA });

  // Wipe and restore A from its backup into A's path only.
  fs.rmSync(pathA, { force: true });
  restoreMemoryStore({ sqlitePath: pathA, backupPath });

  const bodiesA = await listBodies(pathA);
  const bodiesB = await listBodies(pathB);
  assert.ok(bodiesA.includes('SECRET-FROM-A-ONLY'));
  assert.ok(!bodiesB.includes('SECRET-FROM-A-ONLY'));
  assert.ok(bodiesB.includes('data-from-B'));
  assert.ok(!bodiesA.includes('data-from-B'));
});

test('AE-041b: PD-60 stays on minimal durable executor (no Temporal/Restate)', () => {
  const status = durableExecutorStatus();
  assert.equal(status.executor, 'minimal');
  assert.equal(status.temporal, false);
  assert.equal(status.restate, false);
  assert.equal(status.trigger_met, false);
});
