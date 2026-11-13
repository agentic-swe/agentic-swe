'use strict';

/**
 * AE-030h1 — provenance fail-closed at adapter / ingest write paths (Finding B1).
 * Refs ADR-012 A4 / AE-030c AC1.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pluginRoot = path.resolve(__dirname, '..');
const {
  createNodeSqliteMemoryStore,
} = require('../scripts/lib/memory/adapters/node-sqlite-memory-store.cjs');
const {
  openOrCreateDatabase,
  persistDatabase,
  closeDatabase,
  ensureChunksSchema,
  upsertChunkRow,
} = require('../scripts/lib/memory/graph-store.cjs');
const { ingestChunksIntoDb } = require('../scripts/lib/memory/chunk-ingest.cjs');
const { ingestTranscripts } = require('../scripts/lib/memory/session-ingest.cjs');
const { runIncrementalIndex } = require('../scripts/lib/memory/incremental-index.cjs');
const { createMemoryService } = require('../scripts/lib/memory/memory-service.cjs');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('../scripts/lib/memory/config.cjs');

function makeProvenance(origin) {
  return {
    origin,
    actor: 'user:test',
    source_hash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    ingested_at: '2026-11-13T10:00:00.000Z',
  };
}

function parseProvenance(row) {
  assert.ok(row.record_json, 'row must carry record_json');
  const parsed = JSON.parse(String(row.record_json));
  assert.ok(parsed.provenance && typeof parsed.provenance === 'object');
  for (const key of ['origin', 'actor', 'source_hash', 'ingested_at']) {
    assert.ok(String(parsed.provenance[key] || '').trim(), `missing provenance.${key}`);
  }
  return parsed.provenance;
}

describe('AE-030h1 provenance fail-closed on all write paths', () => {
  let tmp;
  let personal;
  let prevPersonal;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-030h1-'));
    personal = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-030h1-personal-'));
    prevPersonal = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = personal;
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'ae-030h1-fixture', version: '1.0.0' })
    );
  });

  after(() => {
    if (prevPersonal === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
    else process.env.AGENTIC_SWE_PERSONAL_ROOT = prevPersonal;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(personal, { recursive: true, force: true });
  });

  it('direct adapter upsert without provenance fails', async () => {
    const store = createNodeSqliteMemoryStore({
      sqlitePath: path.join(tmp, 'adapter-fail', 'memory.sqlite'),
    });
    await store.open();
    try {
      await assert.rejects(
        () =>
          store.upsertChunk({
            path: 'no-prov.md',
            workId: 'team',
            scope: 'organizational',
            body: 'should fail',
          }),
        (err) => err && err.code === 'MISSING_PROVENANCE'
      );
      await assert.rejects(
        () =>
          store.upsertChunk({
            path: 'blank-prov.md',
            workId: 'team',
            scope: 'organizational',
            body: 'should fail',
            recordJson: JSON.stringify({
              provenance: { ...makeProvenance('x'), actor: '  ' },
            }),
          }),
        (err) =>
          err && err.code === 'MISSING_PROVENANCE_FIELD' && err.path === 'provenance.actor'
      );
    } finally {
      await store.close();
    }

    const rawPath = path.join(tmp, 'adapter-fail', 'raw.sqlite');
    const { db } = await openOrCreateDatabase(rawPath);
    try {
      assert.throws(
        () =>
          upsertChunkRow(db, {
            path: 'raw.md',
            scope: 'repository',
            body: 'raw fail',
            recordJson: null,
          }),
        (err) => err && err.code === 'MISSING_PROVENANCE'
      );
    } finally {
      closeDatabase(db);
    }
  });

  it('chunk-ingest writes rows that carry provenance', async () => {
    const root = path.join(tmp, 'chunk-ingest');
    fs.mkdirSync(path.join(root, '.worklogs', 'w1'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.worklogs', 'w1', 'implementation.md'),
      '# Chunk ingest\n\nUNIQUE_CHUNK_INGEST_PROV body\n'
    );
    const merged = loadMergedMemoryConfig(pluginRoot, root);
    const sqlitePath = sqlitePathForProject(merged, root);
    const { db } = await openOrCreateDatabase(sqlitePath);
    try {
      const result = ingestChunksIntoDb(merged, root, db);
      assert.ok(result.chunks >= 1);
      persistDatabase(db, sqlitePath);
      const stmt = db.prepare(
        `SELECT chunk_id, path, body, record_json FROM chunks WHERE body LIKE ?`
      );
      stmt.bind(['%UNIQUE_CHUNK_INGEST_PROV%']);
      assert.ok(stmt.step());
      const row = stmt.getAsObject();
      stmt.free();
      const prov = parseProvenance(row);
      assert.match(String(prov.origin), /^chunk-ingest:/);
      assert.equal(prov.actor, 'system:chunk-ingest');
      assert.ok(String(prov.source_uri || '').includes('.worklogs/'));
    } finally {
      closeDatabase(db);
    }
  });

  it('session-ingest writes rows that carry provenance', async () => {
    const root = path.join(tmp, 'session-ingest');
    const transcripts = path.join(root, 'transcripts');
    fs.mkdirSync(transcripts, { recursive: true });
    const file = path.join(transcripts, 'sess-prov-1.jsonl');
    fs.writeFileSync(
      file,
      `${JSON.stringify({
        role: 'user',
        message: {
          content: [{ type: 'text', text: 'UNIQUE_SESSION_INGEST_PROV please remember this turn' }],
        },
      })}\n`
    );
    const result = await ingestTranscripts({
      projectRoot: root,
      pluginRoot,
      transcriptPaths: [file],
    });
    assert.ok(result.chunks >= 1);
    const { db } = await openOrCreateDatabase(result.sqlitePath);
    try {
      const stmt = db.prepare(
        `SELECT chunk_id, path, body, record_json FROM chunks WHERE body LIKE ?`
      );
      stmt.bind(['%UNIQUE_SESSION_INGEST_PROV%']);
      assert.ok(stmt.step());
      const row = stmt.getAsObject();
      stmt.free();
      const prov = parseProvenance(row);
      assert.match(String(prov.origin), /^session-ingest:/);
      assert.equal(prov.actor, 'system:session-ingest');
      assert.ok(String(prov.source_uri || '').includes('sess-prov-1.jsonl'));
    } finally {
      closeDatabase(db);
    }
  });

  it('incremental-index writes rows that carry provenance', async () => {
    const root = path.join(tmp, 'incremental');
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'docs', 'note.md'),
      '# Note\n\nUNIQUE_INCREMENTAL_PROV indexed body\n'
    );
    const result = await runIncrementalIndex({
      projectRoot: root,
      pluginRoot,
      limit: 50,
    });
    assert.ok(result.updated >= 1);
    assert.ok(result.chunks >= 1);
    const { db } = await openOrCreateDatabase(result.sqlitePath);
    try {
      const stmt = db.prepare(
        `SELECT chunk_id, path, body, record_json FROM chunks WHERE body LIKE ?`
      );
      stmt.bind(['%UNIQUE_INCREMENTAL_PROV%']);
      assert.ok(stmt.step());
      const row = stmt.getAsObject();
      stmt.free();
      const prov = parseProvenance(row);
      assert.match(String(prov.origin), /^incremental-index:/);
      assert.equal(prov.actor, 'system:incremental-index');
      assert.match(String(prov.source_uri || ''), /docs\/note\.md/);
    } finally {
      closeDatabase(db);
    }
  });

  it('legacy row read path still works', async () => {
    const proj = path.join(tmp, 'legacy-project');
    const destDb = path.join(proj, '.agentic-swe', 'memory.sqlite');
    fs.mkdirSync(path.dirname(destDb), { recursive: true });
    fs.writeFileSync(
      path.join(proj, 'package.json'),
      JSON.stringify({ name: 'legacy-proj', version: '1.0.0' })
    );

    const { db } = await openOrCreateDatabase(destDb);
    try {
      ensureChunksSchema(db);
      const ins = db.prepare(
        `INSERT OR REPLACE INTO chunks
          (chunk_id, path, work_id, start_line, end_line, content_sha256, body)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      ins.run([
        'legacy-no-prov-1',
        'docs/legacy.md',
        null,
        1,
        1,
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        'UNIQUE_LEGACY_READ_PROV body without record_json',
      ]);
      ins.free();
      persistDatabase(db, destDb);
    } finally {
      closeDatabase(db);
    }

    const svc = createMemoryService({ pluginRoot, projectRoot: proj });
    try {
      const read = await svc.read({
        scope: 'repository',
        query: 'UNIQUE_LEGACY_READ_PROV',
      });
      assert.equal(read.records.length, 1);
      assert.equal(read.records[0].provenance.origin, 'legacy-chunk');
      assert.equal(read.envelopes[0].trust, 'untrusted');
      assert.equal(read.envelopes[0].body.includes('UNIQUE_LEGACY_READ_PROV'), true);
    } finally {
      await svc.close();
    }
  });
});
