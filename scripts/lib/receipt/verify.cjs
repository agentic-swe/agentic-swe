'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifyWorkJournal, readJournal } = require('../shared/journal.cjs');

/**
 * Verify only the copied work directory. This deliberately does not read
 * policy packs, git, or any network resource.
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
  const imported = chain.events.some((event) => event.integrity === 'unverified-import');
  return {
    ok: true,
    integrity: imported || chain.missing ? 'unanchored' : 'verified',
    head: chain.head,
    events: chain.events.length,
    workId: state.work_id || path.basename(workDir),
  };
}

module.exports = { verifyReceipt };
