'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const GENESIS_HASH = '0'.repeat(64);

function journalPath(workDir) {
  return path.join(workDir, 'journal.jsonl');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

function eventHash(event) {
  const copy = { ...event };
  delete copy.hash;
  return crypto.createHash('sha256').update(JSON.stringify(canonical(copy))).digest('hex');
}

function integrityError(message, seq) {
  const err = new Error(message);
  err.code = 'INTEGRITY_FAILED';
  err.seq = seq;
  return err;
}

/**
 * Verify a journal document. A prefix is a valid chain, so a missing tail is reported
 * only when state.json records a later seq.
 * @param {string} text
 * @returns {{ ok: boolean, events: object[], head: string, missing?: boolean, seq?: number, reason?: string }}
 */
function verifyJournalText(text) {
  const lines = String(text || '').split('\n').filter((line) => line.length > 0);
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  const events = [];
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return { ok: false, events, head: prev, seq: expectedSeq, reason: 'invalid json' };
    }
    if (event.seq !== expectedSeq) {
      return { ok: false, events, head: prev, seq: event.seq || expectedSeq, reason: 'seq' };
    }
    if (event.prev_hash !== prev) {
      return { ok: false, events, head: prev, seq: event.seq, reason: 'prev_hash' };
    }
    if (eventHash(event) !== event.hash) {
      return { ok: false, events, head: prev, seq: event.seq, reason: 'hash' };
    }
    prev = event.hash;
    expectedSeq += 1;
    events.push(event);
  }
  return { ok: true, events, head: prev };
}

function readStateOrNull(workDir, stateFile = 'state.json') {
  try {
    return JSON.parse(fs.readFileSync(path.join(workDir, stateFile), 'utf8'));
  } catch {
    return null;
  }
}

function readJournal(workDir) {
  const file = journalPath(workDir);
  if (!fs.existsSync(file)) return { ok: true, missing: true, events: [], head: GENESIS_HASH };
  return verifyJournalText(fs.readFileSync(file, 'utf8'));
}

/**
 * Chain check plus the on-disk seq. Deleting the last line leaves a valid prefix;
 * state.json still names the removed seq, which fails here.
 */
function verifyWorkJournal(workDir, { stateFile = 'state.json' } = {}) {
  const chain = readJournal(workDir);
  if (!chain.ok) return chain;
  const state = readStateOrNull(workDir, stateFile);
  const recorded = state && state.journal && state.journal.seq;
  const last = chain.events.length ? chain.events[chain.events.length - 1].seq : 0;
  if (typeof recorded === 'number' && recorded !== last) {
    return { ok: false, events: chain.events, head: chain.head, seq: recorded, reason: 'length' };
  }
  return chain;
}

function projectedState(chain) {
  if (!chain || !chain.ok || !chain.events.length) return null;
  return chain.events[chain.events.length - 1].state;
}

/**
 * @returns {{ ok: true } | { ok: false, code: 'INTEGRITY_FAILED', message: string, seq?: number }}
 */
function assertProjection(workDir, state, opts) {
  const chain = verifyWorkJournal(workDir, opts);
  if (!chain.ok) {
    return { ok: false, code: 'INTEGRITY_FAILED', message: `journal FAILED at seq ${chain.seq}`, seq: chain.seq };
  }
  const projected = projectedState(chain);
  if (projected && projected.current_state !== state.current_state) {
    return {
      ok: false,
      code: 'INTEGRITY_FAILED',
      message: `current_state ${state.current_state} does not match journal projection ${projected.current_state}`,
      seq: chain.events[chain.events.length - 1].seq,
    };
  }
  return { ok: true };
}

function historyGap(state) {
  const history = (Array.isArray(state.history) ? state.history : []).filter(
    (entry) => entry && entry.kind !== 'spawn' && entry.from && entry.to
  );
  if (!history.length) {
    if (state.current_state && state.current_state !== 'initialized') {
      return `current_state ${state.current_state} was not reached by a recorded edge`;
    }
    return null;
  }
  const last = history[history.length - 1];
  if (last.to !== state.current_state) {
    return `current_state ${state.current_state} was not reached by a recorded edge (last edge ends at ${last.to})`;
  }
  return null;
}

function integrityReport(workDir, state, opts) {
  const chain = verifyWorkJournal(workDir, opts);
  const gap = historyGap(state);
  if (!chain.ok) return { integrity: `FAILED at seq ${chain.seq}`, historyGap: gap };
  if (chain.missing || chain.events.some((event) => event.integrity === 'unverified-import')) {
    return { integrity: 'unanchored', historyGap: gap };
  }
  const projected = projectedState(chain);
  if (projected && projected.current_state !== state.current_state) {
    return { integrity: `FAILED at seq ${chain.events[chain.events.length - 1].seq}`, historyGap: gap };
  }
  return { integrity: 'verified', historyGap: gap };
}

function appendLine(file, line) {
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, `${line}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const dir = fs.openSync(path.dirname(file), 'r');
  try {
    fs.fsyncSync(dir);
  } catch {
    /* directory fsync is best-effort */
  } finally {
    fs.closeSync(dir);
  }
}

/**
 * Append one event and fsync it before the caller replaces state.json.
 * The snapshot written into the event is the state the caller must persist.
 * @param {string} workDir
 * @param {object} state
 * @param {{ type: string, at?: string, integrity?: string, expectCurrent?: string }} meta
 */
function commitState(workDir, state, meta) {
  const prior = readJournal(workDir);
  if (!prior.ok) throw integrityError(`journal FAILED at seq ${prior.seq}`, prior.seq);
  if (meta.expectCurrent && prior.events.length) {
    const projected = prior.events[prior.events.length - 1].state.current_state;
    if (projected !== meta.expectCurrent) {
      throw integrityError(
        `current_state ${meta.expectCurrent} does not match journal projection ${projected}`,
        prior.events[prior.events.length - 1].seq
      );
    }
  }
  const seq = prior.events.length ? prior.events[prior.events.length - 1].seq + 1 : 1;
  const snapshot = structuredClone(state);
  snapshot.journal = { seq };
  const event = {
    seq,
    prev_hash: prior.events.length ? prior.events[prior.events.length - 1].hash : GENESIS_HASH,
    type: meta.type,
    at: meta.at || snapshot.updated_at,
    state: snapshot,
  };
  if (meta.integrity) event.integrity = meta.integrity;
  event.hash = eventHash(event);
  appendLine(journalPath(workDir), JSON.stringify(event));
  return snapshot;
}

function recoverState(workDir, { stateFile = 'state.json' } = {}) {
  const chain = readJournal(workDir);
  if (!chain.ok) {
    return { ok: false, code: 'INTEGRITY_FAILED', message: `journal FAILED at seq ${chain.seq}`, seq: chain.seq };
  }
  const state = projectedState(chain);
  if (!state) return { ok: false, code: 'JOURNAL_EMPTY', message: 'journal has no events to recover' };
  fs.writeFileSync(path.join(workDir, stateFile), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { ok: true, state };
}

module.exports = {
  GENESIS_HASH,
  journalPath,
  canonical,
  eventHash,
  verifyJournalText,
  readJournal,
  verifyWorkJournal,
  projectedState,
  assertProjection,
  historyGap,
  integrityReport,
  commitState,
  recoverState,
};
