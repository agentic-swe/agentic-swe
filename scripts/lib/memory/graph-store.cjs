'use strict';

/**
 * AE-030e/h5 — native node:sqlite memory graph store (WAL + busy_timeout).
 * Replaces sql.js whole-file export/writeFileSync. Fail closed; no sql.js fallback.
 * AE-030h5: node/edge writes require provenance in record_json (ADR-012 A4).
 * Refs ADR-004b A1–A6 / PD-40 / PD-48 C1–C2.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  BUSY_TIMEOUT_MS,
  STORE_ENGINE,
  STORE_ENGINE_META_KEY,
  BACKUP_SUFFIX,
  loadNodeSqlite,
} = require('./node-sqlite-load.cjs');
const { wrapDatabase } = require('./sqljs-compat.cjs');
const { requireProvenanceFromRecordJson } = require('./provenance.cjs');
const { makeChunkId } = require('./chunk-split.cjs');

const SCHEMA_VERSION = '1';
const CHUNKS_SCHEMA_VERSION = '1';
const EMBEDDINGS_SCHEMA_VERSION = '1';

const DDL = `
CREATE TABLE IF NOT EXISTS memory_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  path TEXT,
  label TEXT,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_nodes_kind ON nodes(kind);
CREATE TABLE IF NOT EXISTS edges (
  src_id TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  meta_json TEXT,
  PRIMARY KEY (src_id, dst_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_edges_src ON edges(src_id);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON edges(dst_id);
`;

const CHUNKS_DDL = `
CREATE TABLE IF NOT EXISTS chunks (
  chunk_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  work_id TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
CREATE INDEX IF NOT EXISTS idx_chunks_work_id ON chunks(work_id);
`;

const CHUNK_EMBEDDINGS_DDL = `
CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  dim INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  vec BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_model ON chunk_embeddings(model_id);
`;

/**
 * @param {string} sqlitePath
 */
function backupPathFor(sqlitePath) {
  return `${sqlitePath}${BACKUP_SUFFIX}`;
}

/**
 * @param {string} sqlitePath
 */
function copyFileSyncRobust(sqlitePath, dest) {
  fs.copyFileSync(sqlitePath, dest);
}

/**
 * @param {string} sqlitePath
 * @param {string} backupPath
 */
function restoreBackup(sqlitePath, backupPath) {
  if (!fs.existsSync(backupPath)) {
    const err = new Error(`migration backup missing: ${backupPath}`);
    err.code = 'STORE_MIGRATE_FAILED';
    throw err;
  }
  fs.copyFileSync(backupPath, sqlitePath);
}

/**
 * @param {*} db wrapped db
 * @param {string} key
 * @returns {string|null}
 */
function readMeta(db, key) {
  const stmt = db.prepare('SELECT value FROM memory_meta WHERE key = ?');
  stmt.bind([key]);
  let value = null;
  if (stmt.step()) {
    const row = stmt.getAsObject();
    value = row.value != null ? String(row.value) : null;
  }
  stmt.free();
  return value;
}

/**
 * @param {*} db
 * @param {string} key
 * @param {string} value
 */
function writeMeta(db, key, value) {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO memory_meta (key, value) VALUES (?, ?)'
  );
  stmt.run([key, value]);
  stmt.free();
}

/** @param {*} db */
function initSchema(db) {
  db.run(DDL);
  writeMeta(db, 'graph_schema_version', SCHEMA_VERSION);
}

/**
 * Chunk table (S2). Lexical search uses LIKE on `chunks.body` (no FTS5 dependency).
 * @param {*} db
 */
function ensureChunksSchema(db) {
  try {
    db.run('DROP TABLE IF EXISTS chunk_fts;');
  } catch {
    /* legacy FTS5 table from earlier sql.js/dev builds */
  }
  db.run(CHUNKS_DDL);
  writeMeta(db, 'chunks_schema_version', CHUNKS_SCHEMA_VERSION);
}

/**
 * @param {*} db
 * @param {string} table
 * @returns {Set<string>}
 */
function tableColumnNames(db, table) {
  const info = db.exec(`PRAGMA table_info(${table})`);
  const cols = new Set();
  if (info[0]) {
    for (const row of info[0].values) {
      cols.add(String(row[1]));
    }
  }
  return cols;
}

/**
 * AE-030h1 — scope + record_json columns required for provenance-carrying writes.
 * @param {*} db
 */
function ensureRecordColumns(db) {
  ensureChunksSchema(db);
  const cols = tableColumnNames(db, 'chunks');
  if (!cols.has('scope')) {
    db.run('ALTER TABLE chunks ADD COLUMN scope TEXT');
  }
  if (!cols.has('record_json')) {
    db.run('ALTER TABLE chunks ADD COLUMN record_json TEXT');
  }
}

/**
 * AE-030h5 — additive record_json on nodes/edges (legacy rows stay readable).
 * @param {*} db
 */
function ensureGraphRecordColumns(db) {
  initSchema(db);
  const nodeCols = tableColumnNames(db, 'nodes');
  if (!nodeCols.has('record_json')) {
    db.run('ALTER TABLE nodes ADD COLUMN record_json TEXT');
  }
  const edgeCols = tableColumnNames(db, 'edges');
  if (!edgeCols.has('record_json')) {
    db.run('ALTER TABLE edges ADD COLUMN record_json TEXT');
  }
}

/**
 * Lowest common chunk write: fails closed without provenance in recordJson.
 * Used by the node-sqlite adapter and legacy ingest paths (chunk/session/incremental).
 * @param {*} db
 * @param {{
 *   chunkId?: string,
 *   path: string,
 *   workId?: string|null,
 *   scope: string,
 *   body: string,
 *   startLine?: number,
 *   endLine?: number,
 *   contentSha256?: string,
 *   recordJson: string,
 * }} row
 */
function upsertChunkRow(db, row) {
  ensureRecordColumns(db);
  const { provenance } = requireProvenanceFromRecordJson(row.recordJson);
  const body = String(row.body ?? '');
  const start = Number(row.startLine) || 1;
  const end = Number(row.endLine) || start;
  const sha =
    row.contentSha256 ||
    crypto.createHash('sha256').update(body).digest('hex');
  const chunkId = row.chunkId || makeChunkId(row.path, start, end, body);
  const workId = row.workId == null || row.workId === '' ? null : String(row.workId);
  const recordJson = String(row.recordJson);

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO chunks
      (chunk_id, path, work_id, start_line, end_line, content_sha256, body, scope, record_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run([
    chunkId,
    String(row.path),
    workId,
    start,
    end,
    sha,
    body,
    String(row.scope),
    recordJson,
  ]);
  stmt.free();
  return { chunkId, contentSha256: sha, provenance };
}

/**
 * Lowest common node write: fails closed without provenance in recordJson.
 * @param {*} db
 * @param {{
 *   id: string,
 *   kind: string,
 *   path?: string|null,
 *   label?: string|null,
 *   metaJson?: string|null,
 *   recordJson: string,
 * }} row
 */
function upsertNodeRow(db, row) {
  ensureGraphRecordColumns(db);
  const { provenance } = requireProvenanceFromRecordJson(row.recordJson);
  const id = String(row.id || '').trim();
  const kind = String(row.kind || '').trim();
  if (!id || !kind) {
    const err = new Error('node id and kind are required');
    err.code = 'MISSING_NODE_FIELDS';
    throw err;
  }
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO nodes (id, kind, path, label, meta_json, record_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  stmt.run([
    id,
    kind,
    row.path != null && String(row.path) !== '' ? String(row.path) : null,
    row.label != null ? String(row.label) : null,
    row.metaJson != null ? String(row.metaJson) : null,
    String(row.recordJson),
  ]);
  stmt.free();
  return { id, provenance };
}

/**
 * Lowest common edge write: fails closed without provenance in recordJson.
 * @param {*} db
 * @param {{
 *   srcId: string,
 *   dstId: string,
 *   kind: string,
 *   metaJson?: string|null,
 *   recordJson: string,
 * }} row
 */
function upsertEdgeRow(db, row) {
  ensureGraphRecordColumns(db);
  const { provenance } = requireProvenanceFromRecordJson(row.recordJson);
  const srcId = String(row.srcId || '').trim();
  const dstId = String(row.dstId || '').trim();
  const kind = String(row.kind || '').trim();
  if (!srcId || !dstId || !kind) {
    const err = new Error('edge srcId, dstId, and kind are required');
    err.code = 'MISSING_EDGE_FIELDS';
    throw err;
  }
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO edges (src_id, dst_id, kind, meta_json, record_json)
     VALUES (?, ?, ?, ?, ?)`
  );
  stmt.run([
    srcId,
    dstId,
    kind,
    row.metaJson != null ? String(row.metaJson) : null,
    String(row.recordJson),
  ]);
  stmt.free();
  return { srcId, dstId, kind, provenance };
}

/**
 * Read-time provenance for a nodes/edges row. Missing record_json → legacy label
 * (never silently trusted).
 * @param {{ record_json?: string|null }} row
 * @param {'node'|'edge'} kind
 */
function provenanceFromGraphRow(row, kind) {
  const legacyOrigin = kind === 'edge' ? 'legacy-edge' : 'legacy-node';
  if (!row || row.record_json == null || String(row.record_json).trim() === '') {
    return {
      origin: legacyOrigin,
      actor: 'system',
      source_hash: '',
      ingested_at: '1970-01-01T00:00:00.000Z',
      legacy: true,
      trust: 'untrusted',
    };
  }
  try {
    const parsed = JSON.parse(String(row.record_json));
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      parsed.provenance &&
      typeof parsed.provenance === 'object'
    ) {
      const p = parsed.provenance;
      const origin = p.origin != null ? String(p.origin).trim() : '';
      if (!origin) {
        return {
          origin: legacyOrigin,
          actor: 'system',
          source_hash: '',
          ingested_at: '1970-01-01T00:00:00.000Z',
          legacy: true,
          trust: 'untrusted',
        };
      }
      return {
        origin,
        actor: p.actor != null ? String(p.actor) : '',
        source_hash: p.source_hash != null ? String(p.source_hash) : '',
        ingested_at: p.ingested_at != null ? String(p.ingested_at) : '',
        ...(p.source_uri != null && String(p.source_uri).trim() !== ''
          ? { source_uri: String(p.source_uri) }
          : {}),
        ...(p.legacy === true || parsed.legacy === true ? { legacy: true } : {}),
        trust:
          parsed.trust != null
            ? String(parsed.trust)
            : p.legacy === true || parsed.legacy === true
              ? 'untrusted'
              : 'untrusted',
      };
    }
  } catch {
    /* fall through to legacy */
  }
  return {
    origin: legacyOrigin,
    actor: 'system',
    source_hash: '',
    ingested_at: '1970-01-01T00:00:00.000Z',
    legacy: true,
    trust: 'untrusted',
  };
}

/**
 * Vector metadata per chunk (S4). Vectors are stored as raw Float32 bytes in `vec`.
 * @param {*} db
 */
function ensureEmbeddingsSchema(db) {
  db.run(CHUNK_EMBEDDINGS_DDL);
  writeMeta(db, 'embeddings_schema_version', EMBEDDINGS_SCHEMA_VERSION);
}

/** @param {*} db */
function clearChunkTables(db) {
  try {
    db.run('DELETE FROM chunk_embeddings;');
  } catch {
    /* ignore */
  }
  try {
    db.run('DELETE FROM chunks;');
  } catch {
    /* ignore */
  }
}

/** @param {*} db */
function clearGraphTables(db) {
  db.run('DELETE FROM edges;');
  db.run('DELETE FROM nodes;');
}

/**
 * Open a DatabaseSync with WAL + busy_timeout, wrapped for legacy callers.
 * @param {string} sqlitePath
 * @param {{ readOnly?: boolean }} [opts]
 */
function openNative(sqlitePath, opts = {}) {
  const { DatabaseSync } = loadNodeSqlite();
  let native;
  try {
    native = new DatabaseSync(sqlitePath, {
      timeout: BUSY_TIMEOUT_MS,
      readOnly: Boolean(opts.readOnly),
    });
  } catch (err) {
    const e = new Error(
      `unreadable memory store: ${sqlitePath}: ${err && err.message ? err.message : err}`
    );
    e.code = 'STORE_UNREADABLE';
    e.cause = err;
    throw e;
  }
  if (!opts.readOnly) {
    try {
      native.exec(`PRAGMA journal_mode=WAL`);
      native.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`);
    } catch (err) {
      try {
        native.close();
      } catch {
        /* ignore */
      }
      const e = new Error(
        `failed to set WAL/busy_timeout on ${sqlitePath}: ${err && err.message ? err.message : err}`
      );
      e.code = 'STORE_UNREADABLE';
      e.cause = err;
      throw e;
    }
  }
  return wrapDatabase(native);
}

/**
 * Apply schema and mark store_engine. Used after open / during migration.
 * @param {*} db
 * @param {{ forceEngineMeta?: boolean }} [opts]
 */
function applySchemaAndEngine(db, opts = {}) {
  initSchema(db);
  ensureChunksSchema(db);
  ensureEmbeddingsSchema(db);
  ensureRecordColumns(db);
  ensureGraphRecordColumns(db);
  const existing = readMeta(db, STORE_ENGINE_META_KEY);
  if (existing && existing !== STORE_ENGINE && existing !== 'sql.js') {
    const err = new Error(`unknown memory store_engine: ${existing}`);
    err.code = 'STORE_UNKNOWN_ENGINE';
    throw err;
  }
  // Avoid rewriting meta on every open (concurrent writers contend on that UPDATE).
  void opts;
  if (existing !== STORE_ENGINE) {
    writeMeta(db, STORE_ENGINE_META_KEY, STORE_ENGINE);
  }
}

/**
 * Migrate an on-disk sql.js (or unmarked) SQLite file to node:sqlite.
 * Backup first; restore backup if migration fails.
 * @param {string} sqlitePath
 * @param {{ injectFailure?: boolean }} [testHooks] — test-only failure injection
 * @returns {{ migrated: boolean, backupPath: string|null }}
 */
function migrateSqlJsFileIfNeeded(sqlitePath, testHooks = {}) {
  if (!fs.existsSync(sqlitePath)) {
    return { migrated: false, backupPath: null };
  }

  const backupPath = backupPathFor(sqlitePath);
  copyFileSyncRobust(sqlitePath, backupPath);

  let db;
  try {
    db = openNative(sqlitePath);
    // Detect legacy engine before schema write.
    let prior = null;
    try {
      prior = readMeta(db, STORE_ENGINE_META_KEY);
    } catch {
      prior = null;
    }
    if (testHooks.injectFailure) {
      const err = new Error('injected migration failure');
      err.code = 'STORE_MIGRATE_FAILED';
      throw err;
    }
    applySchemaAndEngine(db, { forceEngineMeta: true });
    // Rows are already in the SQLite file; opening + meta stamp is the cutover.
    // Verify at least that memory_meta is readable post-write.
    const engine = readMeta(db, STORE_ENGINE_META_KEY);
    if (engine !== STORE_ENGINE) {
      const err = new Error('store_engine meta not set after migration');
      err.code = 'STORE_MIGRATE_FAILED';
      throw err;
    }
    db.close();
    return {
      migrated: prior !== STORE_ENGINE,
      backupPath,
      priorEngine: prior,
    };
  } catch (err) {
    try {
      if (db) db.close();
    } catch {
      /* ignore */
    }
    try {
      restoreBackup(sqlitePath, backupPath);
    } catch (restoreErr) {
      const e = new Error(
        `migration failed and rollback failed: ${err && err.message}; restore: ${restoreErr && restoreErr.message}`
      );
      e.code = 'STORE_MIGRATE_FAILED';
      e.cause = err;
      throw e;
    }
    if (err && err.code === 'STORE_UNKNOWN_ENGINE') {
      throw err;
    }
    const e = new Error(
      `memory store migration failed (restored backup): ${err && err.message ? err.message : err}`
    );
    e.code = err && err.code === 'STORE_UNREADABLE' ? 'STORE_UNREADABLE' : 'STORE_MIGRATE_FAILED';
    e.cause = err;
    throw e;
  }
}

/**
 * @param {string} sqlitePath absolute path
 * @param {{ skipMigrate?: boolean, injectMigrationFailure?: boolean }} [opts]
 * @returns {Promise<{ db: *, SQL: null, migrated?: boolean, backupPath?: string|null }>}
 */
async function openOrCreateDatabase(sqlitePath, opts = {}) {
  loadNodeSqlite();
  const dir = path.dirname(sqlitePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const exists = fs.existsSync(sqlitePath);
  /** @type {{ migrated: boolean, backupPath: string|null, priorEngine?: string|null } | null} */
  let migration = null;

  if (exists && !opts.skipMigrate) {
    // Peek engine without mutating when already native.
    let peek;
    try {
      // readOnly peek avoids WAL conversion before backup (rollback byte-identity).
      peek = openNative(sqlitePath, { readOnly: true });
      let engine = null;
      try {
        engine = readMeta(peek, STORE_ENGINE_META_KEY);
      } catch {
        // No memory_meta yet — treat as legacy / unmarked.
        engine = null;
      }
      peek.close();
      peek = null;
      if (engine === STORE_ENGINE) {
        // Already cut over.
      } else if (engine == null || engine === 'sql.js') {
        migration = migrateSqlJsFileIfNeeded(sqlitePath, {
          injectFailure: Boolean(opts.injectMigrationFailure),
        });
      } else {
        const err = new Error(`unknown memory store_engine: ${engine}`);
        err.code = 'STORE_UNKNOWN_ENGINE';
        throw err;
      }
    } catch (err) {
      try {
        if (peek) peek.close();
      } catch {
        /* ignore */
      }
      if (err && (err.code === 'STORE_UNKNOWN_ENGINE' || err.code === 'STORE_MIGRATE_FAILED')) {
        throw err;
      }
      // Unreadable / not SQLite — fail closed (no sql.js fallback).
      if (err && err.code === 'STORE_UNREADABLE') {
        throw err;
      }
      const e = new Error(
        `unreadable memory store: ${sqlitePath}: ${err && err.message ? err.message : err}`
      );
      e.code = 'STORE_UNREADABLE';
      e.cause = err;
      throw e;
    }
  } else if (exists && opts.injectMigrationFailure) {
    migration = migrateSqlJsFileIfNeeded(sqlitePath, { injectFailure: true });
  }

  const db = openNative(sqlitePath);
  applySchemaAndEngine(db);
  return {
    db,
    SQL: null,
    migrated: Boolean(migration && migration.migrated),
    backupPath: migration ? migration.backupPath : null,
  };
}

/**
 * No-op under node:sqlite — writes are durable via the native file (WAL).
 * Kept so legacy callers that open → mutate → persist → close keep working.
 * @param {*} _db
 * @param {string} sqlitePath
 */
function persistDatabase(_db, sqlitePath) {
  const dir = path.dirname(sqlitePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Intentionally no whole-file rewrite (ADR-004b).
}

/** @param {*} db */
function closeDatabase(db) {
  try {
    if (db && typeof db.close === 'function') db.close();
  } catch {
    /* ignore */
  }
}

/**
 * Read WAL journal_mode and busy_timeout from an open wrapped db (tests).
 * @param {*} db
 */
function readPragmaState(db) {
  const native = db && db._native;
  if (!native) {
    const err = new Error('readPragmaState requires a node:sqlite wrapped db');
    err.code = 'STORE_UNREADABLE';
    throw err;
  }
  const journal = native.prepare('PRAGMA journal_mode').get();
  const busy = native.prepare('PRAGMA busy_timeout').get();
  return {
    journal_mode: String(
      journal.journal_mode || journal.journal || Object.values(journal)[0] || ''
    ).toLowerCase(),
    busy_timeout: Number(busy.timeout ?? busy.busy_timeout ?? Object.values(busy)[0] ?? 0),
  };
}

module.exports = {
  initSchema,
  ensureChunksSchema,
  ensureRecordColumns,
  ensureGraphRecordColumns,
  upsertChunkRow,
  upsertNodeRow,
  upsertEdgeRow,
  provenanceFromGraphRow,
  ensureEmbeddingsSchema,
  clearGraphTables,
  clearChunkTables,
  openOrCreateDatabase,
  persistDatabase,
  closeDatabase,
  migrateSqlJsFileIfNeeded,
  backupPathFor,
  restoreBackup,
  readPragmaState,
  readMeta,
  writeMeta,
  BUSY_TIMEOUT_MS,
  STORE_ENGINE,
  STORE_ENGINE_META_KEY,
  BACKUP_SUFFIX,
  SCHEMA_VERSION,
  CHUNKS_SCHEMA_VERSION,
  EMBEDDINGS_SCHEMA_VERSION,
};
