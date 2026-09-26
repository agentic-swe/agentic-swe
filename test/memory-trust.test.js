'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { annotateTrust, canReplay, decayConfidence, isJevEvidence, promoteTrust } = require('../scripts/lib/memory/trust.cjs');
const { importExternalProcedure, promoteRecordTrust, saveStore, loadStore } = require('../scripts/lib/descent/promotion.cjs');
const { replayProcedureWithTelemetry } = require('../scripts/lib/descent/replay.cjs');

function tempProjectRoot(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-trust-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('external memory cannot replay before promotion', () => {
  const record = annotateTrust({ id: 'memory-1', external: true }, '2026-09-26T00:00:00Z');
  assert.equal(canReplay(record), false);
  assert.equal(canReplay(promoteTrust(record, { confirmations: 2, humanApproved: false })), true);
  assert.equal(canReplay(promoteTrust(record, { confirmations: 0, humanApproved: true })), true);
});

test('confidence decays by one tenth per window', () => {
  const record = annotateTrust({ id: 'memory-2', confidence: 0.9 }, '2026-09-26T00:00:00Z');
  const decayed = decayConfidence(record, '2026-09-28T00:00:00Z', 24 * 60 * 60 * 1000);
  assert.equal(decayed.confidence, 0.7);
});

test('Jev advisory evidence cannot become a procedure', () => {
  const record = { actor: 'jev', kind: 'pipeline.jev_track' };
  assert.equal(isJevEvidence(record), true);
  assert.throws(() => promoteTrust(record, { confirmations: 2, humanApproved: true }), /jev evidence cannot be promoted/);
});

test('a procedure record persisted by importExternalProcedure carries trust fields and blocks replay', (t) => {
  const projectRoot = tempProjectRoot(t);
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}\n');
  const procedure = { actions: [{ type: 'READ_FILE', path: 'package.json' }] };

  const rec = importExternalProcedure({
    projectRoot,
    fingerprint: 'fp-external-1',
    procedure,
    source: 'fleet-import',
  });
  assert.equal(rec.external, true);
  assert.equal(rec.promoted, false);
  assert.equal(rec.source, 'fleet-import');
  assert.equal(typeof rec.confidence, 'number');
  assert.equal(typeof rec.last_confirmed, 'string');

  // The persisted record on disk carries the same trust fields the replay path reads.
  const onDisk = loadStore(projectRoot).procedures.find((p) => p.fingerprint === 'fp-external-1');
  assert.equal(onDisk.external, true);
  assert.equal(onDisk.promoted, false);

  const blocked = replayProcedureWithTelemetry({ projectRoot, procedure: rec.procedure, record: rec });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'external memory not promoted');
});

test('promoteRecordTrust lets a promoted external procedure replay', (t) => {
  const projectRoot = tempProjectRoot(t);
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}\n');
  const procedure = { actions: [{ type: 'READ_FILE', path: 'package.json' }] };

  importExternalProcedure({ projectRoot, fingerprint: 'fp-external-2', procedure, source: 'fleet-import' });
  const promoted = promoteRecordTrust({
    projectRoot,
    fingerprint: 'fp-external-2',
    confirmations: 2,
    humanApproved: false,
  });
  assert.equal(promoted.promoted, true);

  const allowed = replayProcedureWithTelemetry({ projectRoot, procedure: promoted.procedure, record: promoted });
  assert.equal(allowed.ok, true);
});

test('promoteRecordTrust throws for Jev-derived procedure records without touching Jev files', (t) => {
  const projectRoot = tempProjectRoot(t);
  saveStore(projectRoot, {
    procedures: [{ fingerprint: 'fp-jev-1', actor: 'jev', kind: 'pipeline.jev_track', procedure: { actions: [] } }],
  });
  assert.throws(
    () => promoteRecordTrust({ projectRoot, fingerprint: 'fp-jev-1', confirmations: 2, humanApproved: true }),
    /jev evidence cannot be promoted/,
  );
  const stillUnpromoted = loadStore(projectRoot).procedures.find((p) => p.fingerprint === 'fp-jev-1');
  assert.notEqual(stillUnpromoted.promoted, true);
});
