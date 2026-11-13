'use strict';

/**
 * AE-030e — load Node built-in `node:sqlite` with a scoped ExperimentalWarning filter.
 * Refs ADR-004b A1–A2 / PD-48 C1.
 */

const BUSY_TIMEOUT_MS = 5000;
const STORE_ENGINE = 'node:sqlite';
const STORE_ENGINE_META_KEY = 'store_engine';
const BACKUP_SUFFIX = '.pre-node-sqlite.bak';

/** @type {typeof import('node:sqlite') | null} */
let sqliteModule = null;
let warningFilterInstalled = false;

/**
 * Suppress only the SQLite ExperimentalWarning (not every warning).
 */
function installSqliteWarningFilter() {
  if (warningFilterInstalled) return;
  warningFilterInstalled = true;
  const original = process.emitWarning;
  process.emitWarning = function emitWarningFiltered(warning, ...args) {
    const msg =
      typeof warning === 'string'
        ? warning
        : warning && typeof warning === 'object'
          ? String(warning.message || '')
          : String(warning || '');
    const name =
      warning && typeof warning === 'object' ? String(warning.name || '') : '';
    const typeArg =
      typeof args[0] === 'string'
        ? args[0]
        : args[0] && typeof args[0] === 'object'
          ? String(args[0].type || '')
          : '';
    const isExperimental =
      name === 'ExperimentalWarning' ||
      typeArg === 'ExperimentalWarning' ||
      args[0] === 'ExperimentalWarning';
    if (isExperimental && /SQLite is an experimental feature/i.test(msg)) {
      return;
    }
    return original.call(process, warning, ...args);
  };
}

/**
 * @returns {typeof import('node:sqlite')}
 */
function loadNodeSqlite() {
  if (sqliteModule) return sqliteModule;
  installSqliteWarningFilter();
  try {
    // eslint-disable-next-line import/no-unresolved -- Node built-in (engines >=22.13)
    sqliteModule = require('node:sqlite');
  } catch (err) {
    const e = new Error(
      'node:sqlite is unavailable; engines.node must be >=22.13 and --no-experimental-sqlite is unsupported for memory'
    );
    e.code = 'NODE_SQLITE_UNAVAILABLE';
    e.cause = err;
    throw e;
  }
  if (!sqliteModule || typeof sqliteModule.DatabaseSync !== 'function') {
    const e = new Error('node:sqlite DatabaseSync is missing');
    e.code = 'NODE_SQLITE_UNAVAILABLE';
    throw e;
  }
  return sqliteModule;
}

module.exports = {
  BUSY_TIMEOUT_MS,
  STORE_ENGINE,
  STORE_ENGINE_META_KEY,
  BACKUP_SUFFIX,
  installSqliteWarningFilter,
  loadNodeSqlite,
};
