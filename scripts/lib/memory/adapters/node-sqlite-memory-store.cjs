'use strict';

/**
 * AE-030e/h1 — node:sqlite MemoryStore adapter (AE-030b seam, AE-030e cutover).
 * All MemoryService open/persist goes through here → graph-store (native).
 * AE-030h1: upsertChunk fails closed without provenance (ADR-012 A4).
 * Refs ADR-004b A1–A6, ADR-012, ADR-016; PD-48 C2 (fail closed, no legacy fallback).
 */

const path = require('node:path');
const {
  openOrCreateDatabase,
  persistDatabase,
  closeDatabase,
  ensureChunksSchema,
  ensureRecordColumns,
  upsertChunkRow,
} = require('../graph-store.cjs');

const ADAPTER_ID = 'node-sqlite';

/**
 * @param {{ sqlitePath: string }} opts
 */
function createNodeSqliteMemoryStore(opts = {}) {
  const sqlitePath = opts.sqlitePath ? path.resolve(opts.sqlitePath) : null;
  if (!sqlitePath) {
    const err = new Error('node-sqlite adapter requires sqlitePath');
    err.code = 'MISSING_SQLITE_PATH';
    throw err;
  }

  /** @type {{ db: *, open: boolean }} */
  let state = { db: null, open: false };

  async function ensureOpen() {
    if (state.open && state.db) return state.db;
    const { db } = await openOrCreateDatabase(sqlitePath);
    ensureRecordColumns(db);
    // Tombstones table (AE-030d) lives on the adapter side of the seam.
    db.run(`
CREATE TABLE IF NOT EXISTS memory_tombstones (
  id TEXT PRIMARY KEY,
  selector_json TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  scope TEXT,
  path TEXT,
  chunk_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_tombstones_scope ON memory_tombstones(scope);
CREATE INDEX IF NOT EXISTS idx_tombstones_path ON memory_tombstones(path);
`);
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
     *   recordJson: string,
     * }} row
     */
    async upsertChunk(row) {
      const db = await ensureOpen();
      // Fail closed at the lowest common write (graph-store upsertChunkRow).
      return upsertChunkRow(db, row);
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

    /**
     * Soft-delete: remove matching chunks and write tombstones.
     * @param {{
     *   ids?: string[],
     *   path?: string,
     *   scope?: string,
     *   deletedAt?: string,
     *   selector?: object,
     * }} sel
     */
    async deleteChunks(sel = {}) {
      const db = await ensureOpen();
      const deletedAt = sel.deletedAt || new Date().toISOString();
      const selectorJson = JSON.stringify(sel.selector || sel);
      /** @type {Array<{chunk_id:string,path:string,scope:string|null}>} */
      const matched = [];

      if (Array.isArray(sel.ids) && sel.ids.length) {
        for (const id of sel.ids) {
          const stmt = db.prepare(
            'SELECT chunk_id, path, scope FROM chunks WHERE chunk_id = ?'
          );
          stmt.bind([String(id)]);
          if (stmt.step()) matched.push(stmt.getAsObject());
          stmt.free();
        }
      } else if (sel.path) {
        const stmt = db.prepare(
          'SELECT chunk_id, path, scope FROM chunks WHERE path = ?'
        );
        stmt.bind([String(sel.path)]);
        while (stmt.step()) matched.push(stmt.getAsObject());
        stmt.free();
      } else if (sel.scope) {
        const stmt = db.prepare(
          'SELECT chunk_id, path, scope FROM chunks WHERE scope = ?'
        );
        stmt.bind([String(sel.scope)]);
        while (stmt.step()) matched.push(stmt.getAsObject());
        stmt.free();
      }

      const del = db.prepare('DELETE FROM chunks WHERE chunk_id = ?');
      const tomb = db.prepare(
        `INSERT OR REPLACE INTO memory_tombstones
          (id, selector_json, deleted_at, scope, path, chunk_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const row of matched) {
        del.run([row.chunk_id]);
        const tombId = `tomb:${row.chunk_id}`;
        tomb.run([
          tombId,
          selectorJson,
          deletedAt,
          row.scope != null ? String(row.scope) : null,
          row.path != null ? String(row.path) : null,
          String(row.chunk_id),
        ]);
      }
      del.free();
      tomb.free();
      return {
        deleted: matched.map((r) => String(r.chunk_id)),
        count: matched.length,
      };
    },

    /**
     * @param {{ limit?: number }} [opts]
     */
    async listTombstones(opts = {}) {
      const db = await ensureOpen();
      const lim = Math.min(5000, Math.max(1, Number(opts.limit) || 500));
      const stmt = db.prepare(
        `SELECT id, selector_json, deleted_at, scope, path, chunk_id
         FROM memory_tombstones
         ORDER BY deleted_at DESC
         LIMIT ?`
      );
      stmt.bind([lim]);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
  };
}

module.exports = {
  ADAPTER_ID,
  createNodeSqliteMemoryStore,
  ensureRecordColumns,
  ensureChunksSchema,
};
