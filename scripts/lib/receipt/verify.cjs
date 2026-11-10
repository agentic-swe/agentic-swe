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
    for (const art of prior.artifacts || []) {
      if (!art || typeof art.path !== 'string' || typeof art.sha256 !== 'string') continue;
      const file = path.join(workDir, art.path);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return {
          ok: false,
          integrity,
          code: 'ARTIFACT_MISMATCH',
          path: art.path,
          message: `artifact missing: ${art.path}`,
        };
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
