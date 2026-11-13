'use strict';

/**
 * AE-031a/b — append-only learning_records.jsonl store with redact + fingerprint dedupe.
 * Separate from graph-store / MemoryService sqlite. Refs ADR-012, ADR-011.
 */

const fs = require('node:fs');
const path = require('node:path');
const { validateLearningRecord } = require('./learning-record.cjs');
const { prepareLearningWrite, contentFingerprint } = require('./learning-write.cjs');

const DEFAULT_STORE = '.agentic-swe/learning_records.jsonl';
const QUARANTINE_STORE = '.agentic-swe/learning_records.quarantine.jsonl';

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function learningStorePath(projectRoot) {
  return path.join(projectRoot, DEFAULT_STORE);
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function quarantineStorePath(projectRoot) {
  return path.join(projectRoot, QUARANTINE_STORE);
}

/**
 * @param {string} projectRoot
 * @returns {object[]}
 */
function readLearningRecords(projectRoot) {
  return readJsonl(learningStorePath(projectRoot));
}

/**
 * @param {string} projectRoot
 * @returns {object[]}
 */
function readQuarantinedLearningRecords(projectRoot) {
  return readJsonl(quarantineStorePath(projectRoot));
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line));
  }
  return out;
}

function appendJsonl(file, record) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
}

function assertCoreValid(record) {
  const core = {
    id: record.id,
    kind: record.kind,
    work_id: record.work_id,
    source_seq: record.source_seq,
    event_hash: record.event_hash,
    evidence_refs: record.evidence_refs,
    trust: record.trust,
    body: record.body,
    ingested_at: record.ingested_at,
  };
  if (record.payload !== undefined) core.payload = record.payload;
  if (record.redaction !== undefined) core.redaction = record.redaction;
  const check = validateLearningRecord(core);
  if (!check.ok) {
    const detail = (check.errors || [])
      .map((e) => `${e.instancePath || '/'} ${e.message}`)
      .join('; ');
    const err = new Error(`learning record invalid: ${detail}`);
    err.code = 'LEARNING_RECORD_INVALID';
    err.errors = check.errors;
    throw err;
  }
}

/**
 * Append one LearningRecord with redact-on-write + fingerprint dedupe.
 * Duplicate fingerprints → one live + quarantined duplicate.
 * @param {string} projectRoot
 * @param {object} record
 * @returns {{ record: object, quarantined: boolean, live?: object }}
 */
function appendLearningRecord(projectRoot, record) {
  const prepared = prepareLearningWrite(record);
  assertCoreValid(prepared);
  const fp = contentFingerprint(prepared);
  const live = readLearningRecords(projectRoot).filter((r) => r.status !== 'quarantined');
  const existing = live.find((r) => contentFingerprint(r) === fp);
  if (existing) {
    const quarantined = {
      ...prepared,
      id: `${prepared.id}:dup`,
      status: 'quarantined',
      quarantine_reason: 'duplicate_fingerprint',
      duplicate_of: existing.id,
      fingerprint: fp,
      trust: 'untrusted',
    };
    appendJsonl(quarantineStorePath(projectRoot), quarantined);
    return { record: quarantined, quarantined: true, live: existing };
  }
  const written = { ...prepared, status: 'live', fingerprint: fp };
  appendJsonl(learningStorePath(projectRoot), written);
  return { record: written, quarantined: false };
}

/**
 * Replace live store contents with a bundle (ingest rebuild). Applies redact + dedupe.
 * @param {string} projectRoot
 * @param {object[]} records
 */
function writeLearningBundle(projectRoot, records) {
  const file = learningStorePath(projectRoot);
  const qFile = quarantineStorePath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const liveLines = [];
  const quarantineLines = [];
  const seen = new Map();
  for (const raw of records) {
    const prepared = prepareLearningWrite(raw);
    assertCoreValid(prepared);
    const fp = contentFingerprint(prepared);
    if (seen.has(fp)) {
      const live = seen.get(fp);
      quarantineLines.push(
        JSON.stringify({
          ...prepared,
          id: `${prepared.id}:dup`,
          status: 'quarantined',
          quarantine_reason: 'duplicate_fingerprint',
          duplicate_of: live.id,
          fingerprint: fp,
          trust: 'untrusted',
        })
      );
      continue;
    }
    const written = { ...prepared, status: 'live', fingerprint: fp };
    seen.set(fp, written);
    liveLines.push(JSON.stringify(written));
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, liveLines.length ? `${liveLines.join('\n')}\n` : '', 'utf8');
  fs.renameSync(tmp, file);
  if (quarantineLines.length) {
    const qtmp = `${qFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(qtmp, `${quarantineLines.join('\n')}\n`, 'utf8');
    fs.renameSync(qtmp, qFile);
  }
  return {
    live: liveLines.map((l) => JSON.parse(l)),
    quarantined: quarantineLines.map((l) => JSON.parse(l)),
  };
}

/**
 * Live trusted learning set (human_approved or reviewed only).
 * @param {string} projectRoot
 */
function readTrustedLearning(projectRoot) {
  return readLearningRecords(projectRoot).filter(
    (r) =>
      r.status !== 'quarantined' &&
      (r.trust === 'human_approved' || r.trust === 'reviewed')
  );
}

module.exports = {
  DEFAULT_STORE,
  QUARANTINE_STORE,
  learningStorePath,
  quarantineStorePath,
  readLearningRecords,
  readQuarantinedLearningRecords,
  appendLearningRecord,
  writeLearningBundle,
  readTrustedLearning,
};
