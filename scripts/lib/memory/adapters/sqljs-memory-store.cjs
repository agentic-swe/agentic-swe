'use strict';

/**
 * AE-030b — sql.js MemoryStore adapter (only concrete adapter until AE-030e).
 * All sql.js / graph-store open+persist for MemoryService goes through here.
 * Refs ADR-004b (seam stays store-agnostic), ADR-012, ADR-016.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const {
  openOrCreateDatabase,
  persistDatabase,
  closeDatabase,
  ensureChunksSchema,
} = require('../graph-store.cjs');
const { makeChunkId } = require('../chunk-split.cjs');

const ADAPTER_ID = 'sqljs';

/**
 * @param {*} db
 */
function ensureRecordColumns(db) {
  ensureChunksSchema(db);
  const info = db.exec('PRAGMA table_info(chunks)');
  const cols = new Set();
  if (info[0]) {
    for (const row of info[0].values) {
      cols.add(String(row[1]));
    }
  }
  if (!cols.has('scope')) {
    db.run('ALTER TABLE chunks ADD COLUMN scope TEXT');
  }
  if (!cols.has('record_json')) {
    db.run('ALTER TABLE chunks ADD COLUMN record_json TEXT');
  }
}

/**
 * @param {{ sqlitePath: string }} opts
 */
function createSqlJsMemoryStore(opts = {}) {
  const sqlitePath = opts.sqlitePath ? path.resolve(opts.sqlitePath) : null;
  if (!sqlitePath) {
    const err = new Error('sqljs adapter requires sqlitePath');
    err.code = 'MISSING_SQLITE_PATH';
    throw err;
  }

  /** @type {{ db: *, open: boolean }} */
  let state = { db: null, open: false };

  async function ensureOpen() {
    if (state.open && state.db) return state.db;
    const { db } = await openOrCreateDatabase(sqlitePath);
    ensureRecordColumns(db);
    state = { db, open: true };
    return db;
  }

  return {
    id: ADAPTER_ID,
    sqlitePath,

    async open() {
      await ensureOpen();
    },

    async close() {
      if (state.db) {
        closeDatabase(state.db);
      }
      state = { db: null, open: false };
    },

    async persist() {
      const db = await ensureOpen();
      persistDatabase(db, sqlitePath);
    },

    /**
     * @param {{
     *   chunkId?: string,
     *   path: string,
     *   workId: string|null,
     *   scope: string,
     *   body: string,
     *   startLine?: number,
     *   endLine?: number,
     *   contentSha256?: string,
     *   recordJson?: string|null,
     * }} row
     */
    async upsertChunk(row) {
      const db = await ensureOpen();
      const body = String(row.body ?? '');
      const start = Number(row.startLine) || 1;
      const end = Number(row.endLine) || start;
      const sha =
        row.contentSha256 ||
        crypto.createHash('sha256').update(body).digest('hex');
      const chunkId =
        row.chunkId || makeChunkId(row.path, start, end, body);
      const workId = row.workId == null || row.workId === '' ? null : String(row.workId);
      const recordJson =
        row.recordJson == null ? null : String(row.recordJson);

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
      return { chunkId, contentSha256: sha };
    },

    /**
     * Raw chunk rows for a sqlite file (no scope filtering — MemoryService owns that).
     * @param {{ limit?: number }} [opts]
     */
    async listChunks(opts = {}) {
      const db = await ensureOpen();
      const lim = Math.min(5000, Math.max(1, Number(opts.limit) || 500));
      const stmt = db.prepare(
        `SELECT chunk_id, path, work_id, start_line, end_line, content_sha256, body, scope, record_json
         FROM chunks
         LIMIT ?`
      );
      stmt.bind([lim]);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    },
  };
}

module.exports = {
  ADAPTER_ID,
  createSqlJsMemoryStore,
  ensureRecordColumns,
};
