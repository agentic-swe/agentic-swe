'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { annotateTrust, canReplay, isJevEvidence, promoteTrust } = require('../scripts/lib/memory/trust.cjs');
const {
  importExternalProcedure,
  promoteOrDemote,
  promoteRecordTrust,
  saveStore,
  loadStore,
} = require('../scripts/lib/descent/promotion.cjs');
const { replayProcedureWithTelemetry } = require('../scripts/lib/descent/replay.cjs');

function tempProjectRoot(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-trust-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('external memory cannot replay before promotion', () => {
  const record = annotateTrust({ id: 'memory-1', external: true, source: 'fleet-import' }, '2026-09-26T00:00:00Z');
  assert.equal(canReplay(record), false);
  assert.equal(canReplay(promoteTrust(record, { confirmations: 2, humanApproved: false })), true);
  assert.equal(canReplay(promoteTrust(record, { confirmations: 0, humanApproved: true })), true);
});

test('decayConfidence is not part of the trust API (ADR-012 uses discrete trust + TTL)', () => {
  assert.equal(
    Object.prototype.hasOwnProperty.call(require('../scripts/lib/memory/trust.cjs'), 'decayConfidence'),
    false
  );
});

test('Jev advisory evidence cannot become a procedure', () => {
  const record = { actor: 'jev', kind: 'pipeline.jev_track' };
  assert.equal(isJevEvidence(record), true);
  assert.throws(() => promoteTrust(record, { confirmations: 2, humanApproved: true }), /jev evidence cannot be promoted/);
});

test('AE-R1: annotateTrust without source fails closed', () => {
  assert.throws(
    () => annotateTrust({ id: 'memory-r1-missing' }, '2026-09-26T00:00:00Z'),
    /annotateTrust requires an explicit source \(AE-R1\)/,
  );
  assert.throws(
    () => annotateTrust({ id: 'memory-r1-blank', source: '   ' }, '2026-09-26T00:00:00Z'),
    /annotateTrust requires an explicit source \(AE-R1\)/,
  );
  assert.throws(
    () => annotateTrust({ id: 'memory-r1-null', source: null }, '2026-09-26T00:00:00Z'),
    /annotateTrust requires an explicit source \(AE-R1\)/,
  );
});

test("AE-R1: annotateTrust source 'manual' requires actor 'user'", () => {
  assert.throws(
    () => annotateTrust({ id: 'memory-r1-manual-no-actor', source: 'manual' }, '2026-09-26T00:00:00Z'),
    /source 'manual' requires actor 'user' \(AE-R1\)/,
  );
  assert.throws(
    () => annotateTrust({ id: 'memory-r1-manual-system', source: 'manual', actor: 'system' }, '2026-09-26T00:00:00Z'),
    /source 'manual' requires actor 'user' \(AE-R1\)/,
  );
  const ok = annotateTrust(
    { id: 'memory-r1-manual-user', source: 'manual', actor: 'user' },
    '2026-09-26T00:00:00Z',
  );
  assert.equal(ok.source, 'manual');
  assert.equal(ok.actor, 'user');
});

test('AE-R1: promote sites pass explicit non-manual source', (t) => {
  const projectRoot = tempProjectRoot(t);
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{}\n');
  const created = promoteOrDemote({
    projectRoot,
    fingerprint: 'fp-r1-descent',
    procedure: { actions: [] },
    evalPassed: false,
  });
  assert.equal(created.record.source, 'descent-promotion');
  assert.notEqual(created.record.source, 'manual');
  const imported = importExternalProcedure({
    projectRoot,
    fingerprint: 'fp-r1-import-default',
    procedure: { actions: [] },
  });
  assert.equal(imported.source, 'external-import');
  assert.notEqual(imported.source, 'manual');
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
