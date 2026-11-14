'use strict';

/**
 * AE-041b — Backup / restore for the node:sqlite memory store.
 *
 * File-level backup with rollback if restore fails. Tenant stores live under
 * isolated paths (ADR-017 / org-store tenantDir). Stays on the minimal durable
 * executor (PD-60): no Temporal/Restate — a verified ADR-014 trigger was not met.
 *
 * Does not edit graph-store; operates on sqlite files via the MemoryStore seam.
 */

const fs = require('node:fs');
const path = require('node:path');
const { tenantDir } = require('./org-store.cjs');
const {
  createNodeSqliteMemoryStore,
} = require('./adapters/node-sqlite-memory-store.cjs');

/**
 * @param {string} sqlitePath
 * @returns {string}
 */
function defaultBackupPath(sqlitePath) {
  return `${path.resolve(sqlitePath)}.bak`;
}

/**
 * Per-tenant memory sqlite path under a shared store root.
 * @param {string} storeRoot
 * @param {string} tenantId
 * @returns {string}
 */
function tenantMemorySqlitePath(storeRoot, tenantId) {
  return path.join(tenantDir(storeRoot, tenantId), 'memory.sqlite');
}

/**
 * Copy sqlite (+ WAL/SHM sidecars when present) to backupPath.
 * @param {{ sqlitePath: string, backupPath?: string }} opts
 */
function backupMemoryStore(opts) {
  const sqlitePath = path.resolve(opts.sqlitePath);
  if (!fs.existsSync(sqlitePath)) {
    const err = new Error(`memory store missing: ${sqlitePath}`);
    err.code = 'BACKUP_SOURCE_MISSING';
    throw err;
  }
  const backupPath = path.resolve(opts.backupPath || defaultBackupPath(sqlitePath));
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(sqlitePath, backupPath);
  for (const side of ['-wal', '-shm']) {
    const src = sqlitePath + side;
    const dest = backupPath + side;
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
    else if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
  }
  return { ok: true, sqlitePath, backupPath };
}

/**
 * Restore sqlite from backup. Takes a pre-restore safety copy of the live file
 * and rolls back to it if the restore itself fails (or injectFailure is set).
 *
 * @param {{
 *   sqlitePath: string,
 *   backupPath: string,
 *   injectFailure?: boolean,
 * }} opts
 */
function restoreMemoryStore(opts) {
  const sqlitePath = path.resolve(opts.sqlitePath);
  const backupPath = path.resolve(opts.backupPath);
  if (!fs.existsSync(backupPath)) {
    const err = new Error(`backup missing: ${backupPath}`);
    err.code = 'RESTORE_BACKUP_MISSING';
    throw err;
  }

  const safetyPath = `${sqlitePath}.pre-restore`;
  let hadLive = false;
  if (fs.existsSync(sqlitePath)) {
    fs.copyFileSync(sqlitePath, safetyPath);
    hadLive = true;
  }

  try {
    if (opts.injectFailure) {
      const err = new Error('injected restore failure');
      err.code = 'RESTORE_FAILED';
      throw err;
    }
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    fs.copyFileSync(backupPath, sqlitePath);
    for (const side of ['-wal', '-shm']) {
      const src = backupPath + side;
      const dest = sqlitePath + side;
      if (fs.existsSync(src)) fs.copyFileSync(src, dest);
      else if (fs.existsSync(dest)) fs.rmSync(dest, { force: true });
    }
    // Drop safety copy on success.
    if (fs.existsSync(safetyPath)) fs.rmSync(safetyPath, { force: true });
    return { ok: true, sqlitePath, backupPath, rolled_back: false };
  } catch (err) {
    // Rollback: put the pre-restore live file back.
    try {
      if (hadLive && fs.existsSync(safetyPath)) {
        fs.copyFileSync(safetyPath, sqlitePath);
      }
    } catch (rollbackErr) {
      const e = new Error(
        `restore failed and rollback failed: ${err && err.message}; rollback: ${rollbackErr && rollbackErr.message}`,
      );
      e.code = 'RESTORE_ROLLBACK_FAILED';
      e.cause = err;
      throw e;
    } finally {
      if (fs.existsSync(safetyPath)) fs.rmSync(safetyPath, { force: true });
    }
    const e = new Error(
      `memory store restore failed (rolled back): ${err && err.message ? err.message : err}`,
    );
    e.code = (err && err.code) || 'RESTORE_FAILED';
    e.cause = err;
    e.rolled_back = true;
    throw e;
  }
}

/**
 * Open a tenant-scoped fixture store (node:sqlite via MemoryStore adapter).
 * @param {string} storeRoot
 * @param {string} tenantId
 */
async function openTenantMemoryStore(storeRoot, tenantId) {
  const sqlitePath = tenantMemorySqlitePath(storeRoot, tenantId);
  fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
  const store = createNodeSqliteMemoryStore({ sqlitePath });
  await store.open();
  return { store, sqlitePath };
}

/**
 * PD-60 evidence: this module does not depend on Temporal/Restate.
 * @returns {{ executor: 'minimal', temporal: false, restate: false, trigger_met: false }}
 */
function durableExecutorStatus() {
  return {
    executor: 'minimal',
    temporal: false,
    restate: false,
    trigger_met: false,
    note: 'ADR-014 reassessment: no Temporal/Restate trigger met for M5 (PD-60)',
  };
}

module.exports = {
  defaultBackupPath,
  tenantMemorySqlitePath,
  backupMemoryStore,
  restoreMemoryStore,
  openTenantMemoryStore,
  durableExecutorStatus,
};
