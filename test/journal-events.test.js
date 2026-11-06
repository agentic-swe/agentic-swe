'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork, spawnSync } = require('node:child_process');

const {
  commitState,
  readJournal,
  verifyJournalText,
  verifyWorkJournal,
  projectedState,
  assertProjection,
  recoverState,
  appendEvent,
  rebuildIdempotencyIndex,
  journalPath,
} = require('../scripts/lib/shared/journal.cjs');
const { acquireWriteLockSync, releaseWriteLockSync } = require('../scripts/lib/shared/state-lock.cjs');
const { writeJsonAtomic } = require('../scripts/lib/shared/atomic-json.cjs');
const { LEASE_BASENAME, leasePath } = require('../scripts/lib/shared/lease.cjs');

const pluginRoot = path.join(__dirname, '..');
const FIXTURE_JOURNAL = path.join(__dirname, 'fixtures', 'ae-020a-main-journal.jsonl');
const FIXTURE_HEAD = path.join(__dirname, 'fixtures', 'ae-020a-main-journal.head.txt');
const SIDE_WORKER = path.join(__dirname, 'helpers', 'journal-side-worker.cjs');
const LOCK_PROBE = path.join(__dirname, 'helpers', 'journal-lock-probe.cjs');

function tmpWork(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `awe-${name}-`));
  const workDir = path.join(root, '.worklogs', name);
  fs.mkdirSync(workDir, { recursive: true });
  return { root, workDir };
}

function seedSnapshot(workDir, current = 'feasibility') {
  const state = {
    work_id: path.basename(workDir),
    current_state: current,
    updated_at: '2020-01-01T00:00:00.000Z',
    history: [],
  };
  return commitState(workDir, state, { type: 'init', at: state.updated_at });
}

describe('AE-020a journal events, idempotency, and leases', () => {
  it('1: origin/main-style journals verify unchanged with a stable head hash', () => {
    const text = fs.readFileSync(FIXTURE_JOURNAL, 'utf8');
    const expectedHead = fs.readFileSync(FIXTURE_HEAD, 'utf8').trim();
    const first = verifyJournalText(text);
    assert.strictEqual(first.ok, true);
    assert.strictEqual(first.head, expectedHead);
    assert.strictEqual(first.events.length, 2);
    assert.strictEqual(first.events[0].epoch, undefined);
    assert.strictEqual(first.events[1].epoch, undefined);

    const second = verifyJournalText(text);
    assert.strictEqual(second.head, expectedHead);
    assert.strictEqual(second.head, first.head);

    const { root, workDir } = tmpWork('ae020a-fixture');
    fs.writeFileSync(journalPath(workDir), text);
    const onDisk = readJournal(workDir);
    assert.strictEqual(onDisk.ok, true);
    assert.strictEqual(onDisk.head, expectedHead);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('2: appendEvent with a recorded idempotency_key returns the original and appends nothing', () => {
    const { root, workDir } = tmpWork('ae020a-idem');
    seedSnapshot(workDir);
    const first = appendEvent(workDir, {
      type: 'test.side',
      payload: { n: 1 },
      idempotency_key: 'same-key',
    });
    const before = fs.readFileSync(journalPath(workDir), 'utf8');
    const again = appendEvent(workDir, {
      type: 'test.side',
      payload: { n: 99 },
      idempotency_key: 'same-key',
    });
    const after = fs.readFileSync(journalPath(workDir), 'utf8');
    assert.strictEqual(again.seq, first.seq);
    assert.strictEqual(again.hash, first.hash);
    assert.strictEqual(again.payload.n, 1);
    assert.strictEqual(after, before);
    const rebuilt = rebuildIdempotencyIndex(workDir);
    assert.deepStrictEqual(rebuilt['same-key'], { seq: first.seq, hash: first.hash });
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('3: unregistered type or bad payload is EVENT_INVALID and appends nothing', () => {
    const { root, workDir } = tmpWork('ae020a-invalid');
    seedSnapshot(workDir);
    const before = fs.readFileSync(journalPath(workDir), 'utf8');

    assert.throws(
      () => appendEvent(workDir, { type: 'no.such.event', payload: { n: 1 } }),
      (err) => err && err.code === 'EVENT_INVALID'
    );
    assert.throws(
      () => appendEvent(workDir, { type: 'test.side', payload: { bad: true } }),
      (err) => err && err.code === 'EVENT_INVALID'
    );
    assert.throws(
      () => appendEvent(workDir, { type: 'policy.decided', payload: { decision: 'maybe' } }),
      (err) => err && err.code === 'EVENT_INVALID'
    );

    assert.strictEqual(fs.readFileSync(journalPath(workDir), 'utf8'), before);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('4: expired dead lease is reclaimed and journaled; live lease blocks with LOCK_TIMEOUT', () => {
    const { root, workDir } = tmpWork('ae020a-lease');
    seedSnapshot(workDir);

    writeJsonAtomic(
      leasePath(workDir),
      {
        holder: 'pid:99999999',
        host: require('../scripts/lib/shared/lease.cjs').hostname(),
        pid: 99999999,
        token: 'dead-token',
        epoch: 1,
        expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
      { trailingNewline: true }
    );

    const side = appendEvent(workDir, {
      type: 'test.side',
      payload: { note: 'after-reclaim' },
      idempotency_key: 'reclaim-side',
    });
    const chain = readJournal(workDir);
    assert.strictEqual(chain.ok, true);
    const reclaim = chain.events.find((e) => e.type === 'lease.reclaimed');
    assert.ok(reclaim, 'expected lease.reclaimed event');
    assert.strictEqual(reclaim.payload.reason, 'expired_dead');
    assert.strictEqual(reclaim.payload.previous_epoch, 1);
    assert.strictEqual(reclaim.payload.new_epoch, 2);
    assert.strictEqual(side.type, 'test.side');
    assert.ok(side.seq > reclaim.seq);
    assert.strictEqual(side.epoch, reclaim.epoch);

    const held = acquireWriteLockSync(workDir, { maxAttempts: 1 });
    try {
      const probe = spawnSync(process.execPath, [LOCK_PROBE], {
        encoding: 'utf8',
        env: { ...process.env, WORK_DIR: workDir },
      });
      assert.strictEqual(probe.status, 3, probe.stdout + probe.stderr);
      const body = JSON.parse(probe.stdout.trim());
      assert.strictEqual(body.code, 'LOCK_TIMEOUT');
    } finally {
      releaseWriteLockSync(held);
    }

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('5: eight concurrent writers append 400 side events with a contiguous valid chain', async () => {
    const { root, workDir } = tmpWork('ae020a-conc');
    seedSnapshot(workDir);

    const workers = 8;
    const perWorker = 50;
    await Promise.all(
      Array.from({ length: workers }, (_, id) =>
        new Promise((resolve, reject) => {
          const child = fork(SIDE_WORKER, [], {
            env: {
              ...process.env,
              WORK_DIR: workDir,
              WORKER_ID: String(id),
              COUNT: String(perWorker),
              MAX_ATTEMPTS: '800',
            },
          });
          child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`worker ${id} exited ${code}`));
          });
          child.on('error', reject);
        })
      )
    );

    const chain = readJournal(workDir);
    assert.strictEqual(chain.ok, true, chain.reason);
    const side = chain.events.filter((e) => e.type === 'test.side');
    const reclaim = chain.events.filter((e) => e.type === 'lease.reclaimed');
    assert.strictEqual(side.length, 400);
    assert.strictEqual(
      chain.events.length,
      1 + side.length + reclaim.length,
      `expected 1 snapshot + 400 side + ${reclaim.length} reclaim`
    );

    const keys = new Set(side.map((e) => e.idempotency_key));
    assert.strictEqual(keys.size, 400);
    for (let id = 0; id < workers; id++) {
      for (let i = 0; i < perWorker; i++) {
        assert.ok(keys.has(`c${id}-e${i}`), `missing c${id}-e${i}`);
      }
    }

    const seqs = chain.events.map((e) => e.seq);
    assert.deepStrictEqual(seqs, Array.from({ length: seqs.length }, (_, i) => i + 1));
    assert.strictEqual(new Set(seqs).size, seqs.length);
    assert.strictEqual(verifyJournalText(fs.readFileSync(journalPath(workDir), 'utf8')).ok, true);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('6: side events do not change projection; forgery still INTEGRITY_FAILED; recover ignores trailing side events', () => {
    const { root, workDir } = tmpWork('ae020a-proj');
    const snapshot = seedSnapshot(workDir, 'feasibility');
    fs.writeFileSync(path.join(workDir, 'state.json'), `${JSON.stringify(snapshot, null, 2)}\n`);

    appendEvent(workDir, { type: 'test.side', payload: { n: 7 }, idempotency_key: 'proj-1' });
    appendEvent(workDir, { type: 'usage.recorded', payload: { provider: 'none', model: 'none' }, idempotency_key: 'proj-2' });

    const chain = readJournal(workDir);
    assert.strictEqual(chain.ok, true);
    assert.ok(chain.events.length >= 3);
    const projected = projectedState(chain);
    assert.strictEqual(projected.current_state, 'feasibility');
    assert.strictEqual(projected.journal.seq, snapshot.journal.seq);
    assert.strictEqual(verifyWorkJournal(workDir).ok, true);

    const forged = structuredClone(snapshot);
    forged.current_state = 'approval-wait';
    fs.writeFileSync(path.join(workDir, 'state.json'), `${JSON.stringify(forged, null, 2)}\n`);
    const check = assertProjection(workDir, forged);
    assert.strictEqual(check.ok, false);
    assert.strictEqual(check.code, 'INTEGRITY_FAILED');

    const recovered = recoverState(workDir);
    assert.strictEqual(recovered.ok, true);
    assert.strictEqual(recovered.state.current_state, 'feasibility');
    assert.strictEqual(recovered.state.journal.seq, snapshot.journal.seq);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('registers M2 side types and stamps epoch on append', () => {
    const { root, workDir } = tmpWork('ae020a-types');
    seedSnapshot(workDir);
    const events = [
      appendEvent(workDir, { type: 'policy.decided', payload: { decision: 'allow' }, idempotency_key: 'pol' }),
      appendEvent(workDir, { type: 'tool.requested', payload: { tool_id: 'shell' }, idempotency_key: 'tr' }),
      appendEvent(workDir, { type: 'tool.completed', payload: { tool_id: 'shell' }, idempotency_key: 'tc' }),
    ];
    for (const e of events) {
      assert.ok(Number.isInteger(e.epoch) && e.epoch >= 1);
      assert.ok(!Object.prototype.hasOwnProperty.call(e, 'state'));
    }
    assert.ok(LEASE_BASENAME.includes('lease'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('SEQ_CONFLICT when expectedSeq does not match the tail', () => {
    const { root, workDir } = tmpWork('ae020a-seq');
    seedSnapshot(workDir);
    assert.throws(
      () =>
        appendEvent(workDir, {
          type: 'test.side',
          payload: { n: 1 },
          idempotency_key: 'seq-1',
          expectedSeq: 99,
        }),
      (err) => err && err.code === 'SEQ_CONFLICT'
    );
    fs.rmSync(root, { recursive: true, force: true });
  });
});
