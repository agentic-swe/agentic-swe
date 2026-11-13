'use strict';

/**
 * AE-030e — native node:sqlite memory graph store (WAL + busy_timeout).
 * Replaces sql.js whole-file export/writeFileSync. Fail closed; no sql.js fallback.
 * Refs ADR-004b A1–A6 / PD-40 / PD-48 C1–C2.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  BUSY_TIMEOUT_MS,
  STORE_ENGINE,
  STORE_ENGINE_META_KEY,
  BACKUP_SUFFIX,
  loadNodeSqlite,
} = require('./node-sqlite-load.cjs');
const { wrapDatabase } = require('./sqljs-compat.cjs');

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
