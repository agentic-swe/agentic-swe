'use strict';

/**
 * AE-030h5 — provenance on memory graph nodes/edges (Finding B1 residual).
 * Refs ADR-012 A4.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const pluginRoot = path.resolve(__dirname, '..');
const {
  openOrCreateDatabase,
  closeDatabase,
  persistDatabase,
  upsertNodeRow,
  upsertEdgeRow,
  provenanceFromGraphRow,
  ensureGraphRecordColumns,
} = require('../scripts/lib/memory/graph-store.cjs');
const { distillSessionChunk, upsertTypedNodes } = require('../scripts/lib/memory/session-capture.cjs');
const { buildIngestProvenance, attachNodeProvenance } = require('../scripts/lib/memory/provenance.cjs');
const { ingestGraphProject } = require('../scripts/lib/memory/graph-ingest.cjs');
const { runMemoryImport } = require('../scripts/lib/memory/memory-import-apply.cjs');

const ALLOWED_GRAPH_INSERT_FILES = new Set([
  path.normalize('scripts/lib/memory/graph-store.cjs'),
]);

const SCAN_ROOTS = [
  path.join(pluginRoot, 'scripts', 'lib', 'memory'),
  path.join(pluginRoot, 'scripts', 'lib', 'fleet'),
  path.join(pluginRoot, 'scripts', 'lib', 'skills'),
  path.join(pluginRoot, 'scripts'),
  path.join(pluginRoot, 'hooks'),
];

const NODE_INSERT_RE =
  /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+nodes\b|REPLACE\s+INTO\s+nodes\b/i;
const EDGE_INSERT_RE =
  /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+edges\b|REPLACE\s+INTO\s+edges\b/i;

function walkJsFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walkJsFiles(abs, out);
    } else if (ent.isFile() && /\.(cjs|js|mjs)$/.test(ent.name)) {
      out.push(abs);
    }
  }
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

function makeProv(origin) {
  return {
    origin,
    actor: 'user:test',
    source_hash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ingested_at: '2026-11-13T12:00:00.000Z',
  };
}

describe('AE-030h5 node/edge provenance', () => {
  let tmp;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-030h5-'));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('guard: no direct INSERT into nodes/edges outside graph-store helpers', () => {
    const files = [];
    for (const root of SCAN_ROOTS) walkJsFiles(root, files);
    const uniq = [...new Set(files)];
    const offenders = [];
    for (const abs of uniq) {
      const rel = path.relative(pluginRoot, abs).split(path.sep).join('/');
      if (ALLOWED_GRAPH_INSERT_FILES.has(path.normalize(rel))) continue;
      const text = fs.readFileSync(abs, 'utf8');
      if (NODE_INSERT_RE.test(text) || EDGE_INSERT_RE.test(text)) {
        offenders.push(rel);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `direct nodes/edges INSERT outside checked helper:\n${offenders.join('\n')}`
    );
  });

  it('node write without provenance fails closed', async () => {
    const dbPath = path.join(tmp, 'node-fail', 'memory.sqlite');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const { db } = await openOrCreateDatabase(dbPath);
    try {
      assert.throws(
        () =>
          upsertNodeRow(db, {
            id: 'n1',
            kind: 'decision',
            label: 'x',
            recordJson: null,
          }),
        (err) => err && err.code === 'MISSING_PROVENANCE'
      );
      assert.throws(
        () =>
          upsertTypedNodes(db, [
            { id: 'n2', kind: 'lesson', label: 'y', body: 'z' },
          ]),
        (err) => err && err.code === 'MISSING_PROVENANCE'
      );
      assert.throws(
        () =>
          upsertNodeRow(db, {
            id: 'n3',
            kind: 'decision',
            recordJson: JSON.stringify({
              provenance: { ...makeProv('x'), actor: '  ' },
            }),
          }),
        (err) =>
          err && err.code === 'MISSING_PROVENANCE_FIELD' && err.path === 'provenance.actor'
      );
      const count = db.exec('SELECT COUNT(*) AS c FROM nodes');
      assert.equal(Number(count[0].values[0][0]), 0);
    } finally {
      closeDatabase(db);
    }
  });

  it('edge write without provenance fails closed', async () => {
    const dbPath = path.join(tmp, 'edge-fail', 'memory.sqlite');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const { db } = await openOrCreateDatabase(dbPath);
    try {
      assert.throws(
        () =>
          upsertEdgeRow(db, {
            srcId: 'a',
            dstId: 'b',
            kind: 'imports',
            recordJson: '',
          }),
        (err) => err && err.code === 'MISSING_PROVENANCE'
      );
      const count = db.exec('SELECT COUNT(*) AS c FROM edges');
      assert.equal(Number(count[0].values[0][0]), 0);
    } finally {
      closeDatabase(db);
    }
  });

  it('session-capture writes nodes carrying provenance', async () => {
    const dbPath = path.join(tmp, 'session-cap', 'memory.sqlite');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const text =
      'Decision: we will use provenance on graph nodes. Lesson: never skip origin refs.';
    const distilled = distillSessionChunk({ text, workId: 'h5-session', source: 'test' });
    assert.ok(distilled.nodes.length >= 1, 'expected distilled nodes');
    const { db } = await openOrCreateDatabase(dbPath);
    try {
      upsertTypedNodes(
        db,
        attachNodeProvenance(distilled.nodes, {
          source: 'session-capture',
          actor: 'system:session-capture',
          originForNode: (n) => `transcript.jsonl#${n.id}`,
        })
      );
      persistDatabase(db, dbPath);
      const stmt = db.prepare('SELECT id, kind, record_json FROM nodes LIMIT 10');
      let saw = 0;
      while (stmt.step()) {
        const row = stmt.getAsObject();
        const prov = parseProvenance(row);
        assert.match(String(prov.origin), /^session-capture:/);
        assert.equal(prov.actor, 'system:session-capture');
        saw++;
      }
      stmt.free();
      assert.ok(saw >= 1);
    } finally {
      closeDatabase(db);
    }
  });

  it('graph-ingest writes nodes/edges carrying provenance', async () => {
    const root = path.join(tmp, 'graph-ingest');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'h5-graph', dependencies: { lodash: '^4.0.0' } })
    );
    fs.mkdirSync(path.join(root, 'lib'));
    fs.writeFileSync(
      path.join(root, 'lib', 'a.js'),
      `const _ = require('lodash');\nconst b = require('./b');\n`
    );
    fs.writeFileSync(path.join(root, 'lib', 'b.js'), `module.exports = 1;\n`);
    const r = await ingestGraphProject({ projectRoot: root, pluginRoot });
    assert.ok(r.stats.nodes >= 5);
    assert.ok(r.stats.edges >= 5);
    const { db } = await openOrCreateDatabase(r.sqlitePath);
    try {
      const nStmt = db.prepare('SELECT id, record_json FROM nodes');
      let nCount = 0;
      while (nStmt.step()) {
        const row = nStmt.getAsObject();
        const prov = parseProvenance(row);
        assert.match(String(prov.origin), /^graph-ingest:/);
        assert.equal(prov.actor, 'system:graph-ingest');
        nCount++;
      }
      nStmt.free();
      const eStmt = db.prepare('SELECT src_id, dst_id, kind, record_json FROM edges');
      let eCount = 0;
      while (eStmt.step()) {
        const row = eStmt.getAsObject();
        const prov = parseProvenance(row);
        assert.match(String(prov.origin), /^graph-ingest:/);
        assert.equal(prov.actor, 'system:graph-ingest');
        eCount++;
      }
      eStmt.free();
      assert.ok(nCount >= 5);
      assert.ok(eCount >= 5);
    } finally {
      closeDatabase(db);
    }
  });

  it('import writes nodes/edges carrying provenance; rejects missing without legacy flag', async () => {
    const root = path.join(tmp, 'import-ok');
    fs.mkdirSync(path.join(root, '.agentic-swe'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'h5-imp' }));

    const bad = await runMemoryImport({
      projectRoot: root,
      pluginRoot,
      force: true,
      bundle: {
        schema_version: 1,
        nodes: [{ id: 'custom:bad', kind: 'custom', label: 'bad' }],
        edges: [],
        provenance: { source: 'fixture-no-legacy' },
      },
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'MISSING_PROVENANCE');

    const prov = makeProv('memory-import:fixture');
    const good = await runMemoryImport({
      projectRoot: root,
      pluginRoot,
      force: true,
      bundle: {
        schema_version: 1,
        nodes: [
          { id: 'custom:good-a', kind: 'custom', label: 'A', provenance: prov },
          { id: 'custom:good-b', kind: 'custom', label: 'B', provenance: prov },
        ],
        edges: [
          {
            src_id: 'custom:good-a',
            dst_id: 'custom:good-b',
            kind: 'relates_to',
            provenance: { ...prov, origin: 'memory-import:fixture-edge' },
          },
        ],
        provenance: { source: 'fixture-with-prov', imported_at: '2026-11-13T12:00:00.000Z' },
      },
    });
    assert.equal(good.ok, true, good.message || '');
    const { db } = await openOrCreateDatabase(good.sqlitePath);
    try {
      const stmt = db.prepare(
        `SELECT id, record_json FROM nodes WHERE id = ?`
      );
      stmt.bind(['custom:good-a']);
      assert.ok(stmt.step());
      const row = stmt.getAsObject();
      stmt.free();
      const p = parseProvenance(row);
      assert.equal(p.origin, 'memory-import:fixture');

      const eStmt = db.prepare(
        `SELECT record_json FROM edges WHERE kind = 'relates_to'`
      );
      assert.ok(eStmt.step());
      parseProvenance(eStmt.getAsObject());
      eStmt.free();
    } finally {
      closeDatabase(db);
    }

    const legacyRoot = path.join(tmp, 'import-legacy');
    fs.mkdirSync(path.join(legacyRoot, '.agentic-swe'), { recursive: true });
    fs.writeFileSync(path.join(legacyRoot, 'package.json'), JSON.stringify({ name: 'h5-leg' }));
    const legacy = await runMemoryImport({
      projectRoot: legacyRoot,
      pluginRoot,
      force: true,
      bundle: {
        schema_version: 1,
        legacy_import: true,
        nodes: [{ id: 'custom:legacy-n', kind: 'custom', label: 'L' }],
        edges: [],
        provenance: { source: 'legacy-bundle', imported_at: '2026-11-13T12:00:00.000Z' },
      },
    });
    assert.equal(legacy.ok, true, legacy.message || '');
    const { db: ldb } = await openOrCreateDatabase(legacy.sqlitePath);
    try {
      const stmt = ldb.prepare(`SELECT record_json FROM nodes WHERE id = ?`);
      stmt.bind(['custom:legacy-n']);
      assert.ok(stmt.step());
      const row = stmt.getAsObject();
      stmt.free();
      const parsed = JSON.parse(String(row.record_json));
      assert.equal(parsed.legacy, true);
      assert.equal(parsed.trust, 'untrusted');
      assert.match(String(parsed.provenance.origin), /^memory-import:legacy:/);
    } finally {
      closeDatabase(ldb);
    }
  });

  it('migration of a pre-existing DB keeps old rows readable and labeled legacy', async () => {
    const dbPath = path.join(tmp, 'legacy-migrate', 'memory.sqlite');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    // Create a pre-h5 DB without record_json columns, then reopen (additive migrate).
    const { DatabaseSync } = require('node:sqlite');
    {
      const native = new DatabaseSync(dbPath);
      native.exec(`
CREATE TABLE memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  path TEXT,
  label TEXT,
  meta_json TEXT
);
CREATE TABLE edges (
  src_id TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  meta_json TEXT,
  PRIMARY KEY (src_id, dst_id, kind)
);
INSERT INTO memory_meta (key, value) VALUES ('store_engine', 'node:sqlite');
INSERT INTO nodes (id, kind, path, label, meta_json)
  VALUES ('legacy:node-1', 'decision', NULL, 'old', '{"body":"pre-h5"}');
INSERT INTO edges (src_id, dst_id, kind, meta_json)
  VALUES ('legacy:node-1', 'legacy:node-1', 'self', NULL);
`);
      native.close();
    }

    const { db } = await openOrCreateDatabase(dbPath);
    try {
      ensureGraphRecordColumns(db);
      const nStmt = db.prepare(`SELECT id, record_json FROM nodes WHERE id = ?`);
      nStmt.bind(['legacy:node-1']);
      assert.ok(nStmt.step());
      const nRow = nStmt.getAsObject();
      nStmt.free();
      assert.equal(nRow.record_json == null || nRow.record_json === '', true);
      const nProv = provenanceFromGraphRow(nRow, 'node');
      assert.equal(nProv.origin, 'legacy-node');
      assert.equal(nProv.legacy, true);
      assert.equal(nProv.trust, 'untrusted');

      const eStmt = db.prepare(
        `SELECT src_id, dst_id, kind, record_json FROM edges WHERE src_id = ?`
      );
      eStmt.bind(['legacy:node-1']);
      assert.ok(eStmt.step());
      const eRow = eStmt.getAsObject();
      eStmt.free();
      const eProv = provenanceFromGraphRow(eRow, 'edge');
      assert.equal(eProv.origin, 'legacy-edge');
      assert.equal(eProv.legacy, true);

      // New writes still require provenance after migration.
      assert.throws(
        () =>
          upsertNodeRow(db, {
            id: 'new:no-prov',
            kind: 'decision',
            recordJson: null,
          }),
        (err) => err && err.code === 'MISSING_PROVENANCE'
      );

      const provenance = buildIngestProvenance({
        source: 'test',
        originPathOrEvent: 'post-migrate',
        actor: 'system:test',
        sourceHash: crypto.createHash('sha256').update('x').digest('hex'),
      });
      upsertNodeRow(db, {
        id: 'new:with-prov',
        kind: 'decision',
        label: 'fresh',
        recordJson: JSON.stringify({ provenance, trust: 'untrusted' }),
      });
      const check = db.prepare(`SELECT record_json FROM nodes WHERE id = ?`);
      check.bind(['new:with-prov']);
      assert.ok(check.step());
      parseProvenance(check.getAsObject());
      check.free();
    } finally {
      closeDatabase(db);
    }
  });
});
