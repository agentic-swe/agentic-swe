'use strict';

const fs = require('node:fs');
const path = require('node:path');

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

/** @param {*} db sql.js Database */
function initSchema(db) {
  db.run(DDL);
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO memory_meta (key, value) VALUES (?, ?)'
  );
  stmt.run(['graph_schema_version', SCHEMA_VERSION]);
  stmt.free();
}

/**
 * Chunk table (S2). sql.js builds omit the FTS5 extension, so search uses LIKE on `chunks.body`.
 * @param {*} db
 */
function ensureChunksSchema(db) {
  try {
    db.run('DROP TABLE IF EXISTS chunk_fts;');
  } catch {
    /* legacy FTS5 table from earlier dev builds; sql.js has no fts5 module */
  }
  db.run(CHUNKS_DDL);
  const m = db.prepare(
    'INSERT OR REPLACE INTO memory_meta (key, value) VALUES (?, ?)'
  );
  m.run(['chunks_schema_version', CHUNKS_SCHEMA_VERSION]);
  m.free();
}

/**
 * Vector metadata per chunk (S4). Vectors are stored as raw Float32 bytes in `vec`.
 * @param {*} db
 */
function ensureEmbeddingsSchema(db) {
  db.run(CHUNK_EMBEDDINGS_DDL);
  const m = db.prepare(
    'INSERT OR REPLACE INTO memory_meta (key, value) VALUES (?, ?)'
  );
  m.run(['embeddings_schema_version', EMBEDDINGS_SCHEMA_VERSION]);
  m.free();
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

/** @returns {Promise<*>} */
async function loadSqlJs() {
  const initSqlJs = require('sql.js');
  return initSqlJs();
}

/**
 * @param {string} sqlitePath absolute path
 * @returns {Promise<{ db: *, SQL: * }>}
 */
async function openOrCreateDatabase(sqlitePath) {
  const SQL = await loadSqlJs();
  const dir = path.dirname(sqlitePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  let db;
  if (fs.existsSync(sqlitePath)) {
    const buf = fs.readFileSync(sqlitePath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  initSchema(db);
  ensureChunksSchema(db);
  ensureEmbeddingsSchema(db);
  return { db, SQL };
}

/** @param {*} db @param {string} sqlitePath */
function persistDatabase(db, sqlitePath) {
  const dir = path.dirname(sqlitePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const data = db.export();
  fs.writeFileSync(sqlitePath, Buffer.from(data));
}

/** @param {*} db */
function closeDatabase(db) {
  try {
    db.close();
  } catch {
    /* ignore */
  }
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
  SCHEMA_VERSION,
  CHUNKS_SCHEMA_VERSION,
  EMBEDDINGS_SCHEMA_VERSION,
};
