'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LOCK_BASENAME = '.agentic-swe-write.lock';

/** @param {number} ms */
function sleepSync(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    /* bounded spin — avoids shelling out for sleep */
  }
}

/**
 * @param {string} workDir
 * @returns {{ fd: number, lockPath: string } | null}
 */
function tryAcquireLock(workDir) {
  const lockPath = path.join(workDir, LOCK_BASENAME);
  try {
    const fd = fs.openSync(lockPath, 'wx', 0o644);
    return { fd, lockPath };
  } catch (e) {
    if (e && e.code === 'EEXIST') return null;
    throw e;
  }
}

/**
 * Best-effort exclusive lock for state.json writers in this work dir (cross-process).
 * @param {string} workDir absolute .worklogs/<id>
 * @param {{ maxAttempts?: number, baseDelayMs?: number }} [opts]
 * @returns {{ fd: number, lockPath: string }}
 */
function acquireWriteLockSync(workDir, opts = {}) {
  const maxAttempts = opts.maxAttempts != null ? opts.maxAttempts : 50;
  const baseDelayMs = opts.baseDelayMs != null ? opts.baseDelayMs : 12;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const got = tryAcquireLock(workDir);
    if (got) return got;
    const delay = Math.min(200, Math.floor(baseDelayMs + attempt * 4));
    sleepSync(delay);
  }
  const err = new Error(`write lock timeout after ${maxAttempts} attempts (${path.join(workDir, LOCK_BASENAME)})`);
  err.code = 'LOCK_TIMEOUT';
  throw err;
}

/**
 * @param {{ fd: number, lockPath: string } | null} h
 */
function releaseWriteLockSync(h) {
  if (!h) return;
  try {
    fs.closeSync(h.fd);
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(h.lockPath);
  } catch {
    /* ignore */
  }
}

/**
 * @template T
 * @param {string} workDir
 * @param {() => T} fn
 * @param {{ maxAttempts?: number, baseDelayMs?: number }} [opts]
 * @returns {T}
 */
function withWriteLockSync(workDir, fn, opts) {
  const h = acquireWriteLockSync(workDir, opts);
  try {
    return fn();
  } finally {
    releaseWriteLockSync(h);
  }
}

module.exports = {
  LOCK_BASENAME,
  acquireWriteLockSync,
  releaseWriteLockSync,
  withWriteLockSync,
};
