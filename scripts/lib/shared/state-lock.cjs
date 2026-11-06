'use strict';

const path = require('node:path');

const {
  LEASE_BASENAME,
  acquireLease,
  releaseLease,
} = require('./lease.cjs');

/** @deprecated Prefer LEASE_BASENAME; kept for callers that referenced the old lock file name. */
const LOCK_BASENAME = LEASE_BASENAME;

/** @param {number} ms */
function sleepSync(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    /* bounded spin — avoids shelling out for sleep */
  }
}

/**
 * Best-effort exclusive lock for state.json writers in this work dir (cross-process).
 * Backed by an expiring lease file (ADR-004a). Reclaim here does not journal —
 * journal writers must use withJournalWriter / appendEvent for lease.reclaimed events.
 * @param {string} workDir absolute .worklogs/<id>
 * @param {{ maxAttempts?: number, baseDelayMs?: number, ttlMs?: number, holder?: string }} [opts]
 * @returns {{ lease: object, lockPath: string, token: string, reclaimed: boolean, previous: object | null }}
 */
function acquireWriteLockSync(workDir, opts = {}) {
  const maxAttempts = opts.maxAttempts != null ? opts.maxAttempts : 50;
  const baseDelayMs = opts.baseDelayMs != null ? opts.baseDelayMs : 12;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const got = acquireLease(workDir, opts);
      return {
        lease: got.lease,
        lockPath: path.join(workDir, LEASE_BASENAME),
        token: got.lease.token,
        reclaimed: got.reclaimed,
        previous: got.previous,
      };
    } catch (err) {
      if (!err || err.code !== 'LOCK_TIMEOUT') throw err;
      lastErr = err;
      const delay = Math.min(200, Math.floor(baseDelayMs + attempt * 4));
      sleepSync(delay);
    }
  }
  const err = new Error(
    `write lock timeout after ${maxAttempts} attempts (${path.join(workDir, LOCK_BASENAME)})`
  );
  err.code = 'LOCK_TIMEOUT';
  if (lastErr) err.cause = lastErr;
  throw err;
}

/**
 * @param {{ lease?: object, token?: string, lockPath?: string } | null} h
 */
function releaseWriteLockSync(h) {
  if (!h) return;
  const token = h.token || (h.lease && h.lease.token);
  if (!token || !h.lockPath) return;
  const workDir = path.dirname(h.lockPath);
  try {
    releaseLease(workDir, token);
  } catch {
    /* ignore */
  }
}

/**
 * @template T
 * @param {string} workDir
 * @param {() => T} fn
 * @param {{ maxAttempts?: number, baseDelayMs?: number, ttlMs?: number, holder?: string }} [opts]
 * @returns {T}
 */
function withWriteLockSync(workDir, fn, opts) {
  const h = acquireWriteLockSync(workDir, opts);
  try {
    return fn(h);
  } finally {
    releaseWriteLockSync(h);
  }
}

module.exports = {
  LOCK_BASENAME,
  LEASE_BASENAME,
  acquireWriteLockSync,
  releaseWriteLockSync,
  withWriteLockSync,
};
