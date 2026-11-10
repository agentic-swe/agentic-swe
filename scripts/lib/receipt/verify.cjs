'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { verifyWorkJournal, readJournal } = require('../shared/journal.cjs');
const { localAnchorReport } = require('../github/anchor.cjs');

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Verify only the copied work directory. This deliberately does not read
 * policy packs, git, or any network resource.
 *
 * When `receipt.json` is present (a previously rendered receipt), artifact
 * digests are recomputed and compared (ADR-011 ARTIFACT_MISMATCH).
 */
function verifyReceipt(workDir) {
  const stateFile = path.join(workDir, 'state.json');
  if (!fs.existsSync(stateFile)) {
    return { ok: false, code: 'MISSING_STATE', message: 'state.json not found' };
  }
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const chain = readJournal(workDir);
  const result = verifyWorkJournal(workDir);
  if (!result.ok) {
    return {
      ok: false,
      integrity: `FAILED at seq ${result.seq}`,
      code: 'INTEGRITY_FAILED',
      seq: result.seq,
      reason: result.reason || 'journal verification failed',
    };
  }

  let integrity = 'verified';
  if (chain.missing) integrity = 'no-journal';
  else if (chain.events.some((event) => event.integrity === 'unverified-import')) {
    integrity = 'unverified-import';
  }

  const anchor = localAnchorReport(workDir, state);
  if (anchor.anchor === 'ANCHOR_MISMATCH') {
    return {
      ok: false,
      integrity,
      anchor: 'ANCHOR_MISMATCH',
      code: 'ANCHOR_MISMATCH',
      workId: state.work_id || path.basename(workDir),
    };
  }

  const receiptFile = path.join(workDir, 'receipt.json');
  if (fs.existsSync(receiptFile)) {
    let prior;
    try {
      prior = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
    } catch (err) {
      return { ok: false, code: 'RECEIPT_UNREADABLE', message: err.message };
    }
    if (!prior || typeof prior !== 'object' || (prior.artifacts != null && !Array.isArray(prior.artifacts))) {
      return { ok: false, integrity, code: 'RECEIPT_INVALID', message: 'receipt.json artifacts must be an array' };
    }
    const root = fs.realpathSync(path.resolve(workDir));
    for (const art of prior.artifacts || []) {
      // A malformed entry is a failure, not a skip: stripping sha256 must not bypass the check.
      if (!art || typeof art.path !== 'string' || !/^[0-9a-f]{64}$/.test(String(art.sha256 || ''))) {
        return { ok: false, integrity, code: 'RECEIPT_INVALID', message: 'receipt.json artifact entry is malformed' };
      }
      const file = path.resolve(root, art.path);
      // Verify only the copied work directory: refuse paths that escape it.
      if (path.isAbsolute(art.path) || !file.startsWith(root + path.sep)) {
        return { ok: false, integrity, code: 'RECEIPT_INVALID', path: art.path, message: 'artifact path escapes work dir' };
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return {
          ok: false,
          integrity,
          code: 'ARTIFACT_MISMATCH',
          path: art.path,
          message: `artifact missing: ${art.path}`,
        };
      }
      // A symlink inside the work dir must not let verify read files outside it.
      if (!fs.realpathSync(file).startsWith(root + path.sep)) {
        return { ok: false, integrity, code: 'RECEIPT_INVALID', path: art.path, message: 'artifact path escapes work dir' };
      }
      const actual = digestFile(file);
      if (actual !== art.sha256) {
        return {
          ok: false,
          integrity,
          code: 'ARTIFACT_MISMATCH',
          path: art.path,
          expected: art.sha256,
          actual,
        };
      }
    }
  }

  return {
    ok: true,
    integrity,
    trust: String(anchor.anchor || '').includes('(independent)') ? 'enforced' : 'cooperative',
    anchor: anchor.anchor,
    head: chain.head,
    events: chain.events.length,
    workId: state.work_id || path.basename(workDir),
  };
}

module.exports = { verifyReceipt };
