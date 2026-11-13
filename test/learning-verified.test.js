'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  learningBundleFromJournalFile,
} = require('../scripts/lib/memory/learning-from-journal.cjs');
const {
  appendLearningRecord,
  readLearningRecords,
  readQuarantinedLearningRecords,
  learningStorePath,
} = require('../scripts/lib/memory/learning-store.cjs');
const { promoteLearningTrust } = require('../scripts/lib/memory/learning-record.cjs');
const {
  promoteOrDemote,
  approveProcedure,
  isAutoConfirmedOnly,
  isHumanApprovedProcedure,
  loadStore,
} = require('../scripts/lib/descent/promotion.cjs');

const fixtureJournal = path.join(__dirname, 'fixtures', 'learning', 'ae-031a-journal.jsonl');

function tmpProject(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ae031b-${name}-`));
}

function baseRecord(overrides = {}) {
  const bundle = learningBundleFromJournalFile(fixtureJournal, {
    workId: 'ae-031b',
    ingestedAt: '2020-01-01T00:00:00.000Z',
  });
  return { ...bundle.records[0], ...overrides };
}

describe('AE-031b verified-only learning + redact/dedupe', () => {
  it('unverified validation-capture cannot enter trusted learning (fail-closed)', () => {
    const rec = baseRecord({ capture_source: 'validation-capture' });
    assert.throws(
      () => promoteLearningTrust(rec, { toTrust: 'reviewed' }),
      (err) => err && err.code === 'UNVERIFIED_CAPTURE'
    );
    assert.throws(
      () =>
        promoteLearningTrust(rec, {
          toTrust: 'human_approved',
          actor: 'user:founder',
        }),
      (err) => err && err.code === 'UNVERIFIED_CAPTURE'
    );
    // Verified journal-sourced record without unverified capture can become reviewed.
    const clean = baseRecord({ capture_source: 'journal' });
    assert.equal(promoteLearningTrust(clean, { toTrust: 'reviewed' }).trust, 'reviewed');
    // human_approved needs user: or eval digest
    assert.throws(
      () => promoteLearningTrust(clean, { toTrust: 'human_approved' }),
      (err) => err && err.code === 'TRUST_PROMOTION_DENIED'
    );
    assert.equal(
      promoteLearningTrust(clean, {
        toTrust: 'human_approved',
        actor: 'user:founder',
      }).trust,
      'human_approved'
    );
    const digest = 'a'.repeat(64);
    assert.equal(
      promoteLearningTrust(clean, {
        toTrust: 'human_approved',
        evalDigest: digest,
      }).eval_digest,
      digest
    );
  });

  it('duplicate fingerprints → one live + quarantined duplicate', () => {
    const projectRoot = tmpProject('dedupe');
    const rec = baseRecord({ id: 'learn:dup:a' });
    const first = appendLearningRecord(projectRoot, rec);
    assert.equal(first.quarantined, false);
    assert.equal(first.record.status, 'live');
    const second = appendLearningRecord(projectRoot, {
      ...rec,
      id: 'learn:dup:b',
      ingested_at: '2020-01-02T00:00:00.000Z',
    });
    assert.equal(second.quarantined, true);
    assert.equal(second.record.status, 'quarantined');
    assert.equal(second.record.quarantine_reason, 'duplicate_fingerprint');
    assert.equal(second.live.id, first.record.id);
    const live = readLearningRecords(projectRoot);
    const quarantined = readQuarantinedLearningRecords(projectRoot);
    assert.equal(live.length, 1);
    assert.equal(quarantined.length, 1);
    assert.equal(live[0].status, 'live');
    assert.equal(quarantined[0].status, 'quarantined');
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('planted secret in learning write is redacted (redact.cjs only)', () => {
    const projectRoot = tmpProject('redact');
    const secretBody =
      'tool.completed note api_key=sk-abcdefghijklmnopqrstuvwxyz123456 exit_code=0';
    const rec = baseRecord({
      id: 'learn:secret:1',
      body: secretBody,
    });
    const written = appendLearningRecord(projectRoot, rec);
    assert.equal(written.quarantined, false);
    assert.ok(!written.record.body.includes('sk-abcdefghijklmnopqrstuvwxyz123456'));
    assert.match(written.record.body, /\[REDACTED\]/);
    assert.equal(written.record.redaction.applied, true);
    assert.equal(written.record.redaction.ruleset, 'redact.cjs');
    assert.ok(written.record.redaction.hits >= 1);
    const onDisk = JSON.parse(fs.readFileSync(learningStorePath(projectRoot), 'utf8').trim());
    assert.ok(!onDisk.body.includes('sk-abcdefghijklmnopqrstuvwxyz'));
    assert.equal(onDisk.trust, 'untrusted');
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('auto L0 procedures remain auto_confirmed ≠ human_approved (AE-R04 regression)', () => {
    const projectRoot = tmpProject('aer04');
    const fp = 'ae031b-auto-l0';
    const proc = { verify: ['npm test'], steps: [] };
    promoteOrDemote({
      projectRoot,
      fingerprint: fp,
      procedure: proc,
      evalPassed: true,
      successCapture: true,
    });
    promoteOrDemote({
      projectRoot,
      fingerprint: fp,
      procedure: proc,
      evalPassed: true,
      successCapture: true,
    });
    const rec = loadStore(projectRoot).procedures.find((p) => p.fingerprint === fp);
    assert.equal(rec.tier, 'L0');
    assert.equal(rec.auto_confirmed, true);
    assert.notEqual(rec.human_approved, true);
    assert.equal(isAutoConfirmedOnly(rec), true);
    assert.equal(isHumanApprovedProcedure(rec), false);

    const denied = approveProcedure({
      projectRoot,
      fingerprint: fp,
      actor: 'agent:bot',
    });
    assert.equal(denied.ok, false);
    assert.equal(loadStore(projectRoot).procedures[0].human_approved, false);

    const ok = approveProcedure({
      projectRoot,
      fingerprint: fp,
      actor: 'user:founder',
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.record.human_approved, true);
    assert.equal(isHumanApprovedProcedure(ok.record), true);
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('default trust stays untrusted on write', () => {
    const projectRoot = tmpProject('trust-default');
    const written = appendLearningRecord(
      projectRoot,
      baseRecord({ id: 'learn:trust:1', trust: 'human_approved' })
    );
    assert.equal(written.record.trust, 'untrusted');
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
});
