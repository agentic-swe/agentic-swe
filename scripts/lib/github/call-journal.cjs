'use strict';

/**
 * Hash-chained record of GitHub API calls: one JSON line per call with
 * { seq, prev_hash, type: 'github.call', at, call: { method, endpoint, status }, hash }.
 */

const fs = require('node:fs');
const path = require('node:path');
const { GENESIS_HASH, eventHash } = require('../work-engine/journal.cjs');

const CALLS_FILE = 'github-calls.jsonl';

function readCalls(file) {
  if (!fs.existsSync(file)) return { ok: true, events: [] };
  const events = [];
  let prev = GENESIS_HASH;
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    let ev;
    try {
      ev = JSON.parse(lines[i]);
    } catch {
      return { ok: false, seq: i + 1, message: `line ${i + 1} is not JSON` };
    }
    if (ev.seq !== i + 1 || ev.prev_hash !== prev || ev.hash !== eventHash(ev)) {
      return { ok: false, seq: i + 1, message: `call journal FAILED at seq ${i + 1}` };
    }
    prev = ev.hash;
    events.push(ev);
  }
  return { ok: true, events };
}

/**
 * Sink for createGitHubConnector. Appends to `<dir>/github-calls.jsonl` and keeps the
 * calls of this session in `calls` so callers can embed them in a work journal event.
 */
function fileCallJournal(dir) {
  const file = path.join(dir, CALLS_FILE);
  const calls = [];
  return {
    file,
    calls,
    record(call) {
      const prior = readCalls(file);
      if (!prior.ok) {
        const err = new Error(prior.message);
        err.code = 'INTEGRITY_FAILED';
        throw err;
      }
      const last = prior.events[prior.events.length - 1];
      const ev = {
        seq: last ? last.seq + 1 : 1,
        prev_hash: last ? last.hash : GENESIS_HASH,
        type: 'github.call',
        at: call.at,
        call: { method: call.method, endpoint: call.endpoint, status: call.status },
      };
      ev.hash = eventHash(ev);
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(ev)}\n`, 'utf8');
      calls.push(ev.call);
    },
  };
}

/** In-memory sink (tests, dry runs). */
function memoryCallJournal() {
  const calls = [];
  return { calls, record(call) { calls.push({ method: call.method, endpoint: call.endpoint, status: call.status }); } };
}

module.exports = { CALLS_FILE, readCalls, fileCallJournal, memoryCallJournal };
