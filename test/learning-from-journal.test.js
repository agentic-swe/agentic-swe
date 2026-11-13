'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const dns = require('node:dns');

const {
  LEARNING_KINDS,
  DEFAULT_TRUST,
  loadSchema,
  validateLearningRecord,
  assertEvidenceRefs,
  promoteLearningTrust,
  learningRecordFromJournalEvent,
} = require('../scripts/lib/memory/learning-record.cjs');
const {
  readLearningRecords,
  appendLearningRecord,
  learningStorePath,
} = require('../scripts/lib/memory/learning-store.cjs');
const {
  learningBundleFromJournalFile,
  ingestJournalToLearning,
} = require('../scripts/lib/memory/learning-from-journal.cjs');
const { commitState, appendEvent, journalPath } = require('../scripts/lib/shared/journal.cjs');

const root = path.join(__dirname, '..');
const fixtureJournal = path.join(__dirname, 'fixtures', 'learning', 'ae-031a-journal.jsonl');
const fixtureHead = path.join(__dirname, 'fixtures', 'learning', 'ae-031a-journal.head.txt');

function tmpProject(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ae031a-${name}-`));
  return dir;
}

describe('AE-031a LearningRecord schema + journal subscriber', () => {
  it('schema declares learning kinds and requires source_seq + evidence_refs', () => {
    const schema = loadSchema();
    assert.deepEqual(schema.properties.kind.enum, [...LEARNING_KINDS]);
    assert.ok(schema.required.includes('source_seq'));
    assert.ok(schema.required.includes('event_hash'));
    assert.ok(schema.required.includes('evidence_refs'));
    assert.equal(schema.properties.trust.default, 'untrusted');
    assert.equal(DEFAULT_TRUST, 'untrusted');
    assert.equal(schema.properties.evidence_refs.minItems, 1);
  });

  it('fixture journal → learning bundle with source_seq on every record', () => {
    const expectedHead = fs.readFileSync(fixtureHead, 'utf8').trim();
    const { records, head, sourceEvents } = learningBundleFromJournalFile(fixtureJournal, {
      workId: 'ae-031a-fixture',
      ingestedAt: '2020-01-01T00:00:00.000Z',
    });
    assert.equal(head, expectedHead);
    assert.equal(sourceEvents, 5);
    assert.ok(records.length >= 3, `expected learning records, got ${records.length}`);
    const kinds = new Set(records.map((r) => r.kind));
    assert.ok(kinds.has('tool.completed'));
    assert.ok(kinds.has('transition'));
    assert.ok(kinds.has('usage.recorded'));
    for (const rec of records) {
      assert.ok(Number.isInteger(rec.source_seq) && rec.source_seq >= 1, 'source_seq');
      assert.match(rec.event_hash, /^[a-f0-9]{64}$/);
      assert.equal(rec.trust, 'untrusted');
      assert.ok(Array.isArray(rec.evidence_refs) && rec.evidence_refs.length >= 1);
      assert.equal(rec.evidence_refs[0].source_seq, rec.source_seq);
      assert.equal(rec.evidence_refs[0].event_hash, rec.event_hash);
      const check = validateLearningRecord(rec);
      assert.equal(check.ok, true, JSON.stringify(check.errors, null, 2));
    }
  });

  it('ingestJournalToLearning writes learning_records.jsonl under project root', () => {
    const projectRoot = tmpProject('ingest');
    const workDir = path.join(projectRoot, '.worklogs', 'live-work');
    fs.mkdirSync(workDir, { recursive: true });
    const at = '2020-06-01T00:00:00.000Z';
    commitState(
      workDir,
      { work_id: 'live-work', current_state: 'initialized', updated_at: at, history: [] },
      { type: 'init', at }
    );
    const at2 = '2020-06-01T00:00:01.000Z';
    commitState(
      workDir,
      {
        work_id: 'live-work',
        current_state: 'validation',
        updated_at: at2,
        history: [{ from: 'initialized', to: 'validation', at: at2 }],
      },
      { type: 'transition', at: at2 }
    );
    appendEvent(workDir, {
      type: 'tool.completed',
      at: '2020-06-01T00:00:02.000Z',
      payload: { tool_id: 'node.test', exit_code: 0, ok: true },
    });
    appendEvent(workDir, {
      type: 'usage.recorded',
      at: '2020-06-01T00:00:03.000Z',
      payload: {
        provider: 'fixture',
        model: 'local',
        usage_source: 'absent',
        usd: 0,
        cost_source: 'local',
      },
    });

    const result = ingestJournalToLearning({ workDir, projectRoot, workId: 'live-work' });
    assert.ok(fs.existsSync(learningStorePath(projectRoot)));
    assert.ok(result.records.every((r) => Number.isInteger(r.source_seq)));
    const onDisk = readLearningRecords(projectRoot);
    assert.equal(onDisk.length, result.records.length);
    assert.ok(onDisk.some((r) => r.kind === 'tool.completed'));
    assert.ok(onDisk.some((r) => r.kind === 'usage.recorded'));
    assert.ok(onDisk.some((r) => r.kind === 'transition'));
    // init is not a learning kind
    assert.ok(!onDisk.some((r) => r.kind === 'init'));
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('missing evidence ref fails trust promotion (fail-closed)', () => {
    const good = learningBundleFromJournalFile(fixtureJournal).records[0];
    assert.equal(promoteLearningTrust(good, { toTrust: 'reviewed' }).trust, 'reviewed');

    assert.throws(
      () => assertEvidenceRefs({ ...good, evidence_refs: [] }),
      (err) => err && err.code === 'MISSING_EVIDENCE_REF' && err.path === 'evidence_refs'
    );
    assert.throws(
      () => promoteLearningTrust({ ...good, evidence_refs: [] }, { toTrust: 'reviewed' }),
      (err) => err && err.code === 'MISSING_EVIDENCE_REF'
    );
    assert.throws(
      () =>
        promoteLearningTrust(
          { ...good, evidence_refs: [{ source_seq: 1, event_hash: '' }] },
          { toTrust: 'reviewed' }
        ),
      (err) => err && err.code === 'MISSING_EVIDENCE_REF' && /event_hash/.test(err.path)
    );
    assert.throws(
      () =>
        promoteLearningTrust(
          { ...good, source_seq: null, evidence_refs: good.evidence_refs },
          { toTrust: 'reviewed' }
        ),
      (err) => err && err.code === 'MISSING_EVIDENCE_REF' && err.path === 'source_seq'
    );
  });

  it('appendLearningRecord rejects records without source_seq', () => {
    const projectRoot = tmpProject('reject');
    const good = learningBundleFromJournalFile(fixtureJournal).records[0];
    appendLearningRecord(projectRoot, good);
    const bad = { ...good, id: 'bad-missing-seq' };
    delete bad.source_seq;
    assert.throws(
      () => appendLearningRecord(projectRoot, bad),
      (err) => err && err.code === 'LEARNING_RECORD_INVALID'
    );
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('learningRecordFromJournalEvent refuses unsupported kinds', () => {
    assert.throws(
      () =>
        learningRecordFromJournalEvent({
          type: 'init',
          seq: 1,
          hash: 'a'.repeat(64),
        }),
      (err) => err && err.code === 'UNSUPPORTED_LEARNING_KIND'
    );
  });

  it('zero non-loopback network during ingest (transport spies never called)', () => {
    let httpHits = 0;
    let httpsHits = 0;
    let netHits = 0;
    let dnsHits = 0;
    const origHttp = http.request;
    const origHttps = https.request;
    const origConnect = net.connect;
    const origLookup = dns.lookup;

    http.request = function patchedHttp(...args) {
      httpHits += 1;
      return origHttp.apply(this, args);
    };
    https.request = function patchedHttps(...args) {
      httpsHits += 1;
      return origHttps.apply(this, args);
    };
    net.connect = function patchedConnect(...args) {
      netHits += 1;
      return origConnect.apply(this, args);
    };
    dns.lookup = function patchedLookup(...args) {
      dnsHits += 1;
      return origLookup.apply(this, args);
    };

    try {
      const projectRoot = tmpProject('net');
      const { records } = learningBundleFromJournalFile(fixtureJournal, {
        projectRoot,
        workId: 'ae-031a-fixture',
      });
      assert.ok(records.length > 0);
      assert.equal(httpHits, 0);
      assert.equal(httpsHits, 0);
      assert.equal(netHits, 0);
      assert.equal(dnsHits, 0);
      // Ensure fixture journal file itself was local-only.
      assert.ok(fs.existsSync(journalPath(path.join(projectRoot, '.worklogs', 'x'))) === false);
      fs.rmSync(projectRoot, { recursive: true, force: true });
    } finally {
      http.request = origHttp;
      https.request = origHttps;
      net.connect = origConnect;
      dns.lookup = origLookup;
    }
  });
});
