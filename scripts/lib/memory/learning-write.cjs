'use strict';

/**
 * AE-031b — redact-on-write + fingerprint helpers for the learning store.
 * Trust promotion lives in learning-record.cjs (no require cycle). Refs ADR-012 C3.
 */

const crypto = require('node:crypto');
const { redactSecrets, redactDeep } = require('../shared/redact.cjs');
const {
  DEFAULT_TRUST,
  learningFingerprint,
  promoteLearningTrust,
  UNVERIFIED_CAPTURE_SOURCES,
} = require('./learning-record.cjs');

/**
 * Redact body (+ nested payload strings) before persist. PD-48 C3: redact.cjs only.
 * @param {object} record
 * @returns {object}
 */
function redactLearningRecord(record) {
  const bodyRaw = record.body == null ? '' : String(record.body);
  const bodyRedact = redactSecrets(bodyRaw);
  let payload = record.payload;
  let payloadHits = 0;
  if (payload && typeof payload === 'object') {
    const before = JSON.stringify(payload);
    payload = redactDeep(payload);
    const after = JSON.stringify(payload);
    if (before !== after) {
      payloadHits = redactSecrets(before).hits;
    }
  }
  const hits = bodyRedact.hits + payloadHits;
  return {
    ...record,
    body: bodyRedact.redacted,
    ...(payload !== undefined ? { payload } : {}),
    trust: record.trust != null ? record.trust : DEFAULT_TRUST,
    redaction: {
      applied: true,
      ruleset: 'redact.cjs',
      hits,
    },
  };
}

/**
 * Content fingerprint for dedupe (stable across id/ingested_at).
 * @param {object} record
 */
function contentFingerprint(record) {
  if (record.fingerprint && /^[a-f0-9]{64}$/.test(String(record.fingerprint))) {
    return String(record.fingerprint);
  }
  return learningFingerprint({
    kind: record.kind,
    work_id: record.work_id,
    source_seq: record.source_seq,
    event_hash: record.event_hash,
    body: record.body,
  });
}

/**
 * Prepare a record for append: redact, default trust, fingerprint, live status.
 * @param {object} record
 */
function prepareLearningWrite(record) {
  const redacted = redactLearningRecord(record);
  const fingerprint = contentFingerprint(redacted);
  const out = {
    ...redacted,
    fingerprint,
    status: redacted.status === 'quarantined' ? 'quarantined' : 'live',
    trust: redacted.trust != null ? redacted.trust : DEFAULT_TRUST,
  };
  // New writes never start trusted.
  if (out.trust !== 'untrusted') {
    out.trust = DEFAULT_TRUST;
  }
  return out;
}

/**
 * Stable digest helper for tests / callers.
 * @param {string} text
 */
function sha256Hex(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

module.exports = {
  UNVERIFIED_CAPTURE_SOURCES,
  redactLearningRecord,
  contentFingerprint,
  prepareLearningWrite,
  promoteLearningTrust,
  sha256Hex,
};
