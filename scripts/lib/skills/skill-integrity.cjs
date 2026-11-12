'use strict';

/**
 * AE-024b: content digest, lockfile, eval attestation (ADR-010 / SEC-006).
 * Layer: skills (service).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { extractFrontmatter } = require('../catalog/parse-frontmatter.cjs');

const LOCKFILE_NAME = 'skills-lock.json';
const TRUST_FILE = path.join('.agentic-swe', 'skill-trust.json');

function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/**
 * Canonical skill body = SKILL.md after frontmatter (or full file if none).
 * @param {string} raw
 * @returns {string}
 */
function canonicalSkillBody(raw) {
  const ex = extractFrontmatter(String(raw || ''));
  if (!ex) return String(raw || '');
  return String(ex.body || '');
}

function digestSkillBody(raw) {
  return sha256Text(canonicalSkillBody(raw));
}

function digestSkillFile(skillMdPath) {
  return digestSkillBody(fs.readFileSync(skillMdPath, 'utf8'));
}

/**
 * Verify body matches expected digest. Fail closed on mismatch / blank digest.
 * @param {string} raw
 * @param {string} expectedDigest
 * @returns {{ ok: true, digest: string } | { ok: false, code: string, digest?: string, expected?: string }}
 */
function verifySkillDigest(raw, expectedDigest) {
  const expected = String(expectedDigest || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    return { ok: false, code: 'DIGEST_MISSING' };
  }
  const digest = digestSkillBody(raw);
  if (digest !== expected) {
    return { ok: false, code: 'DIGEST_MISMATCH', digest, expected };
  }
  return { ok: true, digest };
}

/**
 * @param {string} lockPath
 * @returns {{ version: number, skills: Record<string, { version: string, digest: string }> }}
 */
function emptyLockfile() {
  return { version: 1, skills: {} };
}

function readLockfile(lockPath) {
  if (!fs.existsSync(lockPath)) return emptyLockfile();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    const err = new Error('skills lockfile parse failed');
    err.code = 'LOCKFILE_INVALID';
    throw err;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.skills || typeof parsed.skills !== 'object') {
    const err = new Error('skills lockfile schema invalid');
    err.code = 'LOCKFILE_INVALID';
    throw err;
  }
  return parsed;
}

function writeLockfileAtomic(lockPath, lock) {
  const dir = path.dirname(lockPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${lockPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, lockPath);
}

/**
 * Pin name → version → digest. Tampering detected on resolve.
 * @param {object} lock
 * @param {string} name
 * @param {{ version: string, digest: string }} pin
 */
function lockPin(lock, name, pin) {
  const n = String(name || '').trim();
  const version = String(pin.version || '').trim();
  const digest = String(pin.digest || '').trim().toLowerCase();
  if (!n || !version || !/^[a-f0-9]{64}$/.test(digest)) {
    const err = new Error('invalid lock pin');
    err.code = 'LOCK_PIN_INVALID';
    throw err;
  }
  lock.skills[n] = { version, digest };
  return lock;
}

/**
 * Resolve a lock pin and optionally verify against raw body.
 * @returns {{ ok: true, version: string, digest: string } | { ok: false, code: string }}
 */
function resolveLockPin(lock, name, rawBody) {
  const entry = lock && lock.skills && lock.skills[name];
  if (!entry || entry.version == null || entry.version === '') {
    return { ok: false, code: 'LOCK_NOT_FOUND' };
  }
  const digest = String(entry.digest || '').trim().toLowerCase();
  // Present pin with blank/invalid digest is tampering, not a missing entry.
  if (!digest) return { ok: false, code: 'LOCK_TAMPERED' };
  if (rawBody != null) {
    const v = verifySkillDigest(rawBody, digest);
    if (!v.ok) return { ok: false, code: v.code === 'DIGEST_MISMATCH' ? 'LOCK_TAMPERED' : v.code };
  } else if (!/^[a-f0-9]{64}$/.test(digest)) {
    return { ok: false, code: 'LOCK_TAMPERED' };
  }
  return { ok: true, version: entry.version, digest };
}

/**
 * Trust entries for project skill shadowing.
 * File: <project>/.agentic-swe/skill-trust.json
 * { "version": 1, "shadows": { "<name>": { "allow": true, "note": "..." } } }
 */
function readTrustFile(projectRoot) {
  const file = path.join(path.resolve(projectRoot), TRUST_FILE);
  if (!fs.existsSync(file)) return { version: 1, shadows: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.shadows || typeof parsed.shadows !== 'object') {
      return { version: 1, shadows: {} };
    }
    return parsed;
  } catch {
    return { version: 1, shadows: {} };
  }
}

function isShadowTrusted(projectRoot, skillName) {
  if (!projectRoot) return false;
  const trust = readTrustFile(projectRoot);
  const entry = trust.shadows && trust.shadows[skillName];
  return !!(entry && entry.allow === true);
}

/**
 * External eval attestation: suite id + result_digest + timestamp.
 * Self-declared eval_status alone is never enough.
 * @param {object|null|undefined} attestation
 * @returns {{ ok: true } | { ok: false, code: string }}
 */
function checkEvalAttestation(attestation) {
  if (!attestation || typeof attestation !== 'object' || Array.isArray(attestation)) {
    return { ok: false, code: 'ATTESTATION_MISSING' };
  }
  const suite = String(attestation.suite_id || '').trim();
  const digest = String(attestation.result_digest || '').trim().toLowerCase();
  const ts = String(attestation.timestamp || '').trim();
  if (!suite) return { ok: false, code: 'ATTESTATION_MISSING' };
  if (!/^[a-f0-9]{64}$/.test(digest)) return { ok: false, code: 'ATTESTATION_DIGEST_INVALID' };
  if (!ts) return { ok: false, code: 'ATTESTATION_MISSING' };
  return { ok: true };
}

module.exports = {
  LOCKFILE_NAME,
  TRUST_FILE,
  sha256Text,
  canonicalSkillBody,
  digestSkillBody,
  digestSkillFile,
  verifySkillDigest,
  emptyLockfile,
  readLockfile,
  writeLockfileAtomic,
  lockPin,
  resolveLockPin,
  readTrustFile,
  isShadowTrusted,
  checkEvalAttestation,
};
