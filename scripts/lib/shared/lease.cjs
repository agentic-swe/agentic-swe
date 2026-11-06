'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { writeJsonAtomic } = require('./atomic-json.cjs');

const LEASE_BASENAME = '.agentic-swe-write.lease.json';
const DEFAULT_TTL_MS = 30_000;

function leasePath(workDir) {
  return path.join(workDir, LEASE_BASENAME);
}

function assertNotSymlink(filePath) {
  let st;
  try {
    st = fs.lstatSync(filePath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
  if (st.isSymbolicLink()) {
    const err = new Error(`refusing symlinked store path: ${filePath}`);
    err.code = 'SYMLINK_REFUSED';
    throw err;
  }
}

function lockTimeout(message) {
  const err = new Error(message);
  err.code = 'LOCK_TIMEOUT';
  return err;
}

function hostname() {
  try {
    return os.hostname() || 'unknown';
  } catch {
    return 'unknown';
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !(err && (err.code === 'ESRCH' || err.code === 'ENOENT'));
  }
}

/**
 * @param {string} workDir
 * @returns {object | null}
 */
function readLease(workDir) {
  const file = leasePath(workDir);
  assertNotSymlink(file);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeLease(workDir, lease) {
  const file = leasePath(workDir);
  assertNotSymlink(file);
  fs.mkdirSync(workDir, { recursive: true });
  writeJsonAtomic(file, lease, { trailingNewline: true });
}

/**
 * Create the lease file exclusively (O_EXCL). Returns false on EEXIST.
 * @param {string} file
 * @param {object} lease
 * @returns {boolean}
 */
function tryCreateExclusive(file, lease) {
  const body = `${JSON.stringify(lease, null, 2)}\n`;
  let fd;
  try {
    fd = fs.openSync(file, 'wx', 0o644);
    fs.writeSync(fd, body);
    fs.fsyncSync(fd);
    return true;
  } catch (err) {
    if (err && err.code === 'EEXIST') return false;
    throw err;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

function holderIsLive(lease, host = hostname()) {
  if (!lease || typeof lease !== 'object') return false;
  if (lease.host !== host) return false;
  return isPidAlive(Number(lease.pid));
}

function isExpired(lease, now = Date.now()) {
  if (!lease || typeof lease.expires_at !== 'string') return true;
  const t = Date.parse(lease.expires_at);
  return !Number.isFinite(t) || t <= now;
}

function buildLease(opts, epoch, now, ttlMs) {
  return {
    holder: opts.holder || `pid:${process.pid}`,
    host: hostname(),
    pid: process.pid,
    token: crypto.randomBytes(16).toString('hex'),
    epoch,
    expires_at: new Date(now + ttlMs).toISOString(),
  };
}

/**
 * Acquire (or reclaim) the work-dir write lease.
 * Uses exclusive create so concurrent reclaimers cannot both win.
 * @param {string} workDir
 * @param {{ ttlMs?: number, holder?: string, now?: number, acquireAttempts?: number }} [opts]
 * @returns {{ lease: object, reclaimed: boolean, previous: object | null }}
 */
function acquireLease(workDir, opts = {}) {
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : DEFAULT_TTL_MS;
  const now = opts.now != null ? opts.now : Date.now();
  const host = hostname();
  const file = leasePath(workDir);
  assertNotSymlink(file);
  fs.mkdirSync(workDir, { recursive: true });

  const attempts = opts.acquireAttempts != null ? opts.acquireAttempts : 8;
  for (let i = 0; i < attempts; i++) {
    const previous = readLease(workDir);
    if (!previous) {
      const lease = buildLease(opts, 1, now, ttlMs);
      if (tryCreateExclusive(file, lease)) {
        return { lease, reclaimed: false, previous: null };
      }
      continue;
    }

    if (holderIsLive(previous, host)) {
      throw lockTimeout(`write lease held by pid ${previous.pid} on ${previous.host}`);
    }
    if (!isExpired(previous, now)) {
      throw lockTimeout(
        `write lease epoch ${previous.epoch} held by dead pid ${previous.pid} until ${previous.expires_at}`
      );
    }

    const again = readLease(workDir);
    if (!again || again.token !== previous.token) continue;

    try {
      fs.unlinkSync(file);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
      continue;
    }

    const epoch = Number.isInteger(previous.epoch) ? previous.epoch + 1 : 1;
    const lease = buildLease(opts, epoch, now, ttlMs);
    if (tryCreateExclusive(file, lease)) {
      return { lease, reclaimed: true, previous };
    }
  }

  throw lockTimeout(`write lease acquire raced after ${attempts} attempts`);
}

/**
 * Extend expires_at for a lease we hold.
 * @param {string} workDir
 * @param {string} token
 * @param {{ ttlMs?: number, now?: number }} [opts]
 * @returns {object}
 */
function renewLease(workDir, token, opts = {}) {
  const ttlMs = opts.ttlMs != null ? opts.ttlMs : DEFAULT_TTL_MS;
  const now = opts.now != null ? opts.now : Date.now();
  const current = readLease(workDir);
  if (!current || current.token !== token) {
    const err = new Error('cannot renew lease: token mismatch or missing lease');
    err.code = 'LEASE_FENCED';
    throw err;
  }
  const next = {
    ...current,
    expires_at: new Date(now + ttlMs).toISOString(),
  };
  writeLease(workDir, next);
  return next;
}

/**
 * Release if token matches.
 * @param {string} workDir
 * @param {string} token
 */
function releaseLease(workDir, token) {
  const file = leasePath(workDir);
  assertNotSymlink(file);
  const current = readLease(workDir);
  if (!current) return;
  if (current.token !== token) return;
  try {
    fs.unlinkSync(file);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err;
  }
}

module.exports = {
  LEASE_BASENAME,
  DEFAULT_TTL_MS,
  leasePath,
  assertNotSymlink,
  readLease,
  acquireLease,
  renewLease,
  releaseLease,
  holderIsLive,
  isExpired,
  isPidAlive,
  hostname,
};
