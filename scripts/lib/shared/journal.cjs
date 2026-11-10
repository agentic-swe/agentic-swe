'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { writeJsonAtomic } = require('./atomic-json.cjs');
const {
  acquireLease,
  releaseLease,
  readLease,
  assertNotSymlink,
  DEFAULT_TTL_MS,
} = require('./lease.cjs');
const {
  ensureDefaults,
  isSnapshotType,
  isSideType,
  validateEvent,
} = require('./journal-registry.cjs');

const GENESIS_HASH = '0'.repeat(64);
const IDEMPOTENCY_INDEX = 'idempotency-index.json';

function journalPath(workDir) {
  return path.join(workDir, 'journal.jsonl');
}

function idempotencyIndexPath(workDir) {
  return path.join(workDir, IDEMPOTENCY_INDEX);
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

function codedError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  if (extra && typeof extra === 'object') Object.assign(err, extra);
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
  assertNotSymlink(file);
  if (!fs.existsSync(file)) return { ok: true, missing: true, events: [], head: GENESIS_HASH };
  return verifyJournalText(fs.readFileSync(file, 'utf8'));
}

function lastSnapshotSeq(chain) {
  if (!chain || !chain.events || !chain.events.length) return 0;
  for (let i = chain.events.length - 1; i >= 0; i--) {
    const event = chain.events[i];
    if (event && event.state != null && typeof event.state === 'object' && !Array.isArray(event.state)) {
      return event.seq;
    }
  }
  return 0;
}

/**
 * Chain check plus the on-disk snapshot seq. Deleting the last snapshot leaves a
 * valid prefix; state.json still names the removed seq, which fails here.
 * Side events after a snapshot do not bump state.journal.seq, so length is
 * compared against the last snapshot-bearing event — not the absolute tail.
 */
function verifyWorkJournal(workDir, { stateFile = 'state.json' } = {}) {
  const chain = readJournal(workDir);
  if (!chain.ok) return chain;
  const state = readStateOrNull(workDir, stateFile);
  const recorded = state && state.journal && state.journal.seq;
  const last = lastSnapshotSeq(chain);
  if (typeof recorded === 'number' && recorded !== last) {
    return { ok: false, events: chain.events, head: chain.head, seq: recorded, reason: 'length' };
  }
  return chain;
}

/**
 * Walk backward to the last snapshot-bearing event. Side events never project.
 */
function projectedState(chain) {
  if (!chain || !chain.ok || !chain.events.length) return null;
  for (let i = chain.events.length - 1; i >= 0; i--) {
    const event = chain.events[i];
    if (event && event.state != null && typeof event.state === 'object' && !Array.isArray(event.state)) {
      return event.state;
    }
  }
  return null;
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
  if (chain.missing) {
    return { integrity: 'no-journal', historyGap: gap };
  }
  if (chain.events.some((event) => event.integrity === 'unverified-import')) {
    return { integrity: 'unverified-import', historyGap: gap };
  }
  const projected = projectedState(chain);
  if (projected && projected.current_state !== state.current_state) {
    return { integrity: `FAILED at seq ${chain.events[chain.events.length - 1].seq}`, historyGap: gap };
  }
  return { integrity: 'verified', historyGap: gap };
}

function appendLine(file, line) {
  assertNotSymlink(file);
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

function sleepSync(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    /* bounded spin */
  }
}

function acquireLeaseWithRetry(workDir, opts = {}) {
  const maxAttempts = opts.maxAttempts != null ? opts.maxAttempts : 80;
  const baseDelayMs = opts.baseDelayMs != null ? opts.baseDelayMs : 12;
  let lastErr = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return acquireLease(workDir, opts);
    } catch (err) {
      if (!err || err.code !== 'LOCK_TIMEOUT') throw err;
      lastErr = err;
      const delay = Math.min(200, Math.floor(baseDelayMs + attempt * 4));
      sleepSync(delay);
    }
  }
  throw lastErr || codedError('LOCK_TIMEOUT', `write lease timeout after ${maxAttempts} attempts`);
}

function leaseHeldByUs(workDir) {
  const lease = readLease(workDir);
  if (!lease) return null;
  if (Number(lease.pid) !== process.pid) return null;
  try {
    const { hostname } = require('./lease.cjs');
    if (lease.host !== hostname()) return null;
  } catch {
    return null;
  }
  return lease;
}

/**
 * Rebuild idempotency key → {seq, hash} from the journal chain.
 * @param {string} workDir
 * @returns {Record<string, { seq: number, hash: string }>}
 */
function rebuildIdempotencyIndex(workDir) {
  const chain = readJournal(workDir);
  if (!chain.ok) {
    throw integrityError(`journal FAILED at seq ${chain.seq}`, chain.seq);
  }
  /** @type {Record<string, { seq: number, hash: string }>} */
  const index = {};
  for (const event of chain.events) {
    if (event && typeof event.idempotency_key === 'string' && event.idempotency_key) {
      index[event.idempotency_key] = { seq: event.seq, hash: event.hash };
    }
  }
  const file = idempotencyIndexPath(workDir);
  assertNotSymlink(file);
  writeJsonAtomic(file, index, { trailingNewline: true });
  return index;
}

function loadIdempotencyIndex(workDir) {
  const file = idempotencyIndexPath(workDir);
  assertNotSymlink(file);
  if (!fs.existsSync(file)) return rebuildIdempotencyIndex(workDir);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return rebuildIdempotencyIndex(workDir);
    }
    return parsed;
  } catch {
    return rebuildIdempotencyIndex(workDir);
  }
}

function persistIdempotencyIndex(workDir, index) {
  const file = idempotencyIndexPath(workDir);
  assertNotSymlink(file);
  writeJsonAtomic(file, index, { trailingNewline: true });
}

function confirmIdempotentHit(chain, key, entry) {
  if (!entry || typeof entry.seq !== 'number' || typeof entry.hash !== 'string') return null;
  const event = chain.events[entry.seq - 1];
  if (!event) return null;
  if (event.seq !== entry.seq) return null;
  if (event.hash !== entry.hash) return null;
  if (event.idempotency_key !== key) return null;
  return event;
}

function appendRawEvent(workDir, event) {
  const file = journalPath(workDir);
  fs.mkdirSync(workDir, { recursive: true });
  appendLine(file, JSON.stringify(event));
  return event;
}

function nextSeqAndPrev(chain) {
  if (!chain.events.length) return { seq: 1, prev_hash: GENESIS_HASH };
  const last = chain.events[chain.events.length - 1];
  return { seq: last.seq + 1, prev_hash: last.hash };
}

function stampEpoch(event, lease) {
  if (lease && Number.isInteger(lease.epoch)) {
    event.epoch = lease.epoch;
  }
  return event;
}

function fenceLease(workDir, lease) {
  if (!lease) return;
  const current = readLease(workDir);
  if (!current) {
    throw codedError('LEASE_FENCED', 'lease missing during append');
  }
  if (current.epoch !== lease.epoch || current.token !== lease.token) {
    throw codedError('LEASE_FENCED', `lease epoch ${lease.epoch} fenced by epoch ${current.epoch}`);
  }
}

/**
 * Append a lease.reclaimed side event while the reclaiming writer already holds the lease.
 * @param {string} workDir
 * @param {object} lease
 * @param {object | null} previous
 */
function appendLeaseReclaimed(workDir, lease, previous) {
  ensureDefaults();
  const chain = readJournal(workDir);
  if (!chain.ok) throw integrityError(`journal FAILED at seq ${chain.seq}`, chain.seq);
  fenceLease(workDir, lease);
  const { seq, prev_hash } = nextSeqAndPrev(chain);
  const payload = {
    previous_holder: previous && previous.holder != null ? String(previous.holder) : 'unknown',
    previous_pid: previous && Number.isInteger(previous.pid) ? previous.pid : -1,
    previous_epoch:
      previous && Number.isInteger(previous.epoch) && previous.epoch >= 1 ? previous.epoch : 1,
    new_epoch: lease.epoch,
    reason: 'expired_dead',
  };
  const check = validateEvent('lease.reclaimed', payload);
  if (!check.ok) throw codedError(check.code, check.message);
  const event = stampEpoch(
    {
      seq,
      prev_hash,
      type: 'lease.reclaimed',
      at: new Date().toISOString(),
      payload,
    },
    lease
  );
  event.hash = eventHash(event);
  return appendRawEvent(workDir, event);
}

/**
 * Acquire the work-dir lease, journal lease.reclaimed on reclaim, then run fn.
 * @template T
 * @param {string} workDir
 * @param {(lease: object) => T} fn
 * @param {{ maxAttempts?: number, baseDelayMs?: number, ttlMs?: number, holder?: string }} [opts]
 * @returns {T}
 */
function withJournalWriter(workDir, fn, opts = {}) {
  const got = acquireLeaseWithRetry(workDir, opts);
  try {
    if (got.reclaimed && got.previous) {
      appendLeaseReclaimed(workDir, got.lease, got.previous);
    }
    return fn(got.lease);
  } finally {
    releaseLease(workDir, got.lease.token);
  }
}

/**
 * Append a typed side event (no state). Snapshot types must use commitState.
 * @param {string} workDir
 * @param {{ type: string, payload: object, idempotency_key?: string, expectedSeq?: number, at?: string }} spec
 * @param {{ lease?: object, maxAttempts?: number, baseDelayMs?: number, ttlMs?: number }} [opts]
 */
function appendEvent(workDir, spec, opts = {}) {
  ensureDefaults();
  if (!spec || typeof spec !== 'object') {
    throw codedError('EVENT_INVALID', 'appendEvent requires a spec object');
  }
  const type = spec.type;
  const payload = spec.payload;
  const check = validateEvent(type, payload);
  if (!check.ok) throw codedError(check.code, check.message);
  if (isSnapshotType(type)) {
    throw codedError('EVENT_INVALID', `snapshot type ${type} must be written via commitState`);
  }

  const run = (lease) => appendEventWithLease(workDir, spec, lease);
  if (opts.lease) return run(opts.lease);
  return withJournalWriter(workDir, run, opts);
}

function appendEventWithLease(workDir, spec, lease) {
  fenceLease(workDir, lease);
  const chain = readJournal(workDir);
  if (!chain.ok) throw integrityError(`journal FAILED at seq ${chain.seq}`, chain.seq);

  const key = spec.idempotency_key;
  if (typeof key === 'string' && key) {
    let index = loadIdempotencyIndex(workDir);
    let hit = confirmIdempotentHit(chain, key, index[key]);
    if (index[key] && !hit) {
      index = rebuildIdempotencyIndex(workDir);
      hit = confirmIdempotentHit(chain, key, index[key]);
    }
    if (hit) return hit;
  }

  if (spec.expectedSeq != null) {
    const tailSeq = chain.events.length ? chain.events[chain.events.length - 1].seq : 0;
    if (tailSeq !== spec.expectedSeq) {
      throw codedError(
        'SEQ_CONFLICT',
        `expectedSeq ${spec.expectedSeq} but journal tail is ${tailSeq}`,
        { expectedSeq: spec.expectedSeq, actualSeq: tailSeq }
      );
    }
  }

  fenceLease(workDir, lease);
  const { seq, prev_hash } = nextSeqAndPrev(chain);
  const event = stampEpoch(
    {
      seq,
      prev_hash,
      type: spec.type,
      at: spec.at || new Date().toISOString(),
      payload: spec.payload,
    },
    lease
  );
  if (typeof key === 'string' && key) event.idempotency_key = key;
  event.hash = eventHash(event);
  appendRawEvent(workDir, event);

  if (typeof key === 'string' && key) {
    const index = loadIdempotencyIndex(workDir);
    index[key] = { seq: event.seq, hash: event.hash };
    persistIdempotencyIndex(workDir, index);
  }
  return event;
}

/**
 * Append one event and fsync it before the caller replaces state.json.
 * The snapshot written into the event is the state the caller must persist.
 * @param {string} workDir
 * @param {object} state
 * @param {{ type: string, at?: string, integrity?: string, expectCurrent?: string, expectedSeq?: number }} meta
 * @param {{ lease?: object, maxAttempts?: number, baseDelayMs?: number, ttlMs?: number }} [opts]
 */
function commitState(workDir, state, meta, opts = {}) {
  ensureDefaults();
  const type = meta && meta.type;
  if (!type || typeof type !== 'string') {
    throw codedError('EVENT_INVALID', 'commitState requires meta.type');
  }
  if (isSideType(type)) {
    throw codedError('EVENT_INVALID', `side event type ${type} must be written via appendEvent`);
  }
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    throw codedError('EVENT_INVALID', 'commitState requires a state object');
  }

  const run = (lease) => commitStateWithLease(workDir, state, meta, lease);
  if (opts.lease) return run(opts.lease);

  const held = leaseHeldByUs(workDir);
  if (held) return run(held);

  return withJournalWriter(workDir, run, opts);
}

function commitStateWithLease(workDir, state, meta, lease) {
  fenceLease(workDir, lease);
  const prior = readJournal(workDir);
  if (!prior.ok) throw integrityError(`journal FAILED at seq ${prior.seq}`, prior.seq);
  if (meta.expectCurrent && prior.events.length) {
    const projected = projectedState(prior);
    if (!projected || projected.current_state !== meta.expectCurrent) {
      throw integrityError(
        `current_state ${meta.expectCurrent} does not match journal projection ${
          projected ? projected.current_state : '(none)'
        }`,
        prior.events[prior.events.length - 1].seq
      );
    }
  }
  if (meta.expectedSeq != null) {
    const tailSeq = prior.events.length ? prior.events[prior.events.length - 1].seq : 0;
    if (tailSeq !== meta.expectedSeq) {
      throw codedError(
        'SEQ_CONFLICT',
        `expectedSeq ${meta.expectedSeq} but journal tail is ${tailSeq}`,
        { expectedSeq: meta.expectedSeq, actualSeq: tailSeq }
      );
    }
  }
  fenceLease(workDir, lease);
  const { seq, prev_hash } = nextSeqAndPrev(prior);
  const snapshot = structuredClone(state);
  snapshot.journal = { seq };
  const event = stampEpoch(
    {
      seq,
      prev_hash,
      type: meta.type,
      at: meta.at || snapshot.updated_at,
      state: snapshot,
    },
    lease
  );
  if (meta.integrity) event.integrity = meta.integrity;
  event.hash = eventHash(event);
  appendRawEvent(workDir, event);
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
  IDEMPOTENCY_INDEX,
  journalPath,
  idempotencyIndexPath,
  canonical,
  eventHash,
  verifyJournalText,
  readJournal,
  verifyWorkJournal,
  lastSnapshotSeq,
  projectedState,
  assertProjection,
  historyGap,
  integrityReport,
  commitState,
  recoverState,
  appendEvent,
  withJournalWriter,
  rebuildIdempotencyIndex,
  DEFAULT_TTL_MS,
};
