'use strict';

/**
 * AE-031a — LearningRecord normalize + trust-promotion evidence gate.
 * Separate from MemoryRecord / graph-store. Refs ADR-011, ADR-012.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LEARNING_KINDS = Object.freeze([
  'tool.completed',
  'transition',
  'usage.recorded',
]);

const TRUST_VALUES = Object.freeze(['untrusted', 'reviewed', 'human_approved']);
const DEFAULT_TRUST = 'untrusted';

const SCHEMA_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'schemas',
  'learning-record.schema.json'
);

let cachedValidator = null;

function loadSchema() {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

function getValidator() {
  if (cachedValidator) return cachedValidator;
  const Ajv = require('ajv/dist/2020').default;
  const ajv = new Ajv({ allErrors: true, strict: false });
  cachedValidator = ajv.compile(loadSchema());
  return cachedValidator;
}

/**
 * @param {unknown} record
 * @returns {{ ok: true } | { ok: false, errors: object[] }}
 */
function validateLearningRecord(record) {
  const validate = getValidator();
  if (validate(record)) return { ok: true };
  return { ok: false, errors: validate.errors || [] };
}

/**
 * Fail closed: every trusted-learning candidate needs evidence_refs with source_seq.
 * @param {object} record
 * @returns {{ ok: true, refs: object[] } | never}
 */
function assertEvidenceRefs(record) {
  const refs = record && Array.isArray(record.evidence_refs) ? record.evidence_refs : null;
  if (!refs || refs.length === 0) {
    const err = new Error('learning record missing evidence_refs');
    err.code = 'MISSING_EVIDENCE_REF';
    err.path = 'evidence_refs';
    throw err;
  }
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    if (!ref || typeof ref !== 'object') {
      const err = new Error(`evidence_refs[${i}] must be an object`);
      err.code = 'MISSING_EVIDENCE_REF';
      err.path = `evidence_refs/${i}`;
      throw err;
    }
    const seq = Number(ref.source_seq);
    if (!Number.isInteger(seq) || seq < 1) {
      const err = new Error(`evidence_refs[${i}].source_seq missing or invalid`);
      err.code = 'MISSING_EVIDENCE_REF';
      err.path = `evidence_refs/${i}/source_seq`;
      throw err;
    }
    const hash = String(ref.event_hash || '').trim();
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      const err = new Error(`evidence_refs[${i}].event_hash missing or invalid`);
      err.code = 'MISSING_EVIDENCE_REF';
      err.path = `evidence_refs/${i}/event_hash`;
      throw err;
    }
  }
  return { ok: true, refs };
}

/** Capture sources that are never trusted without human/eval attestation (AE-031b). */
const UNVERIFIED_CAPTURE_SOURCES = Object.freeze([
  'validation-capture',
  'validation_capture',
  'unverified',
  'regex-capture',
]);

/**
 * AE-031b verified-only trust promotion. Missing evidence / unverified capture fail closed.
 * human_approved requires user: actor or attested eval digest.
 * @param {object} record
 * @param {{ toTrust?: string, actor?: string, evalDigest?: string }} [opts]
 * @returns {object} record with elevated trust
 */
function promoteLearningTrust(record, opts = {}) {
  assertEvidenceRefs(record);
  const sourceSeq = Number(record.source_seq);
  if (!Number.isInteger(sourceSeq) || sourceSeq < 1) {
    const err = new Error('learning record missing source_seq');
    err.code = 'MISSING_EVIDENCE_REF';
    err.path = 'source_seq';
    throw err;
  }
  const eventHash = String(record.event_hash || '').trim();
  if (!/^[a-f0-9]{64}$/.test(eventHash)) {
    const err = new Error('learning record missing event_hash');
    err.code = 'MISSING_EVIDENCE_REF';
    err.path = 'event_hash';
    throw err;
  }

  const captureSource = String(
    record.capture_source ||
      record.source ||
      (record.payload && record.payload.capture_source) ||
      ''
  ).trim();
  if (UNVERIFIED_CAPTURE_SOURCES.includes(captureSource)) {
    const err = new Error(
      `unverified capture source cannot enter trusted learning: ${captureSource}`
    );
    err.code = 'UNVERIFIED_CAPTURE';
    err.path = 'capture_source';
    throw err;
  }

  const toTrust = opts.toTrust != null ? String(opts.toTrust) : 'reviewed';
  if (!TRUST_VALUES.includes(toTrust) || toTrust === 'untrusted') {
    const err = new Error(`invalid promotion trust: ${toTrust}`);
    err.code = 'INVALID_TRUST_PROMOTION';
    err.path = 'trust';
    throw err;
  }

  if (toTrust === 'reviewed') {
    return { ...record, trust: 'reviewed' };
  }

  const actor = opts.actor != null ? String(opts.actor) : '';
  const evalDigest = opts.evalDigest != null ? String(opts.evalDigest).trim() : '';
  const humanOk = actor.startsWith('user:');
  const digestOk = /^[a-f0-9]{64}$/.test(evalDigest);
  if (!humanOk && !digestOk) {
    const err = new Error(
      'human_approved requires user: actor or attested eval digest'
    );
    err.code = 'TRUST_PROMOTION_DENIED';
    err.path = 'trust';
    throw err;
  }
  return {
    ...record,
    trust: 'human_approved',
    ...(humanOk ? { approved_by: actor } : {}),
    ...(digestOk ? { eval_digest: evalDigest } : {}),
  };
}

/**
 * Build a LearningRecord from a verified journal event.
 * @param {object} event journal event (seq, hash, type, ...)
 * @param {{ workId?: string, ingestedAt?: string }} [opts]
 */
function learningRecordFromJournalEvent(event, opts = {}) {
  if (!event || typeof event !== 'object') {
    const err = new Error('journal event required');
    err.code = 'EVENT_INVALID';
    throw err;
  }
  const kind = String(event.type || '');
  if (!LEARNING_KINDS.includes(kind)) {
    const err = new Error(`unsupported learning kind: ${kind}`);
    err.code = 'UNSUPPORTED_LEARNING_KIND';
    err.path = 'kind';
    throw err;
  }
  const source_seq = Number(event.seq);
  if (!Number.isInteger(source_seq) || source_seq < 1) {
    const err = new Error('journal event missing seq');
    err.code = 'MISSING_EVIDENCE_REF';
    err.path = 'source_seq';
    throw err;
  }
  const event_hash = String(event.hash || '').trim();
  if (!/^[a-f0-9]{64}$/.test(event_hash)) {
    const err = new Error('journal event missing hash');
    err.code = 'MISSING_EVIDENCE_REF';
    err.path = 'event_hash';
    throw err;
  }

  const work_id =
    (opts.workId && String(opts.workId)) ||
    (event.state && event.state.work_id && String(event.state.work_id)) ||
    'unknown';

  const payload = summarizePayload(kind, event);
  const body = summarizeBody(kind, event, payload);
  const ingested_at = opts.ingestedAt || new Date().toISOString();
  const id = `learn:${kind}:${source_seq}:${event_hash.slice(0, 12)}`;

  return {
    id,
    kind,
    work_id,
    source_seq,
    event_hash,
    evidence_refs: [{ source_seq, event_hash }],
    trust: DEFAULT_TRUST,
    body,
    payload,
    ingested_at,
  };
}

/**
 * @param {string} kind
 * @param {object} event
 */
function summarizePayload(kind, event) {
  if (kind === 'tool.completed') {
    const p = event.payload && typeof event.payload === 'object' ? event.payload : {};
    return {
      tool_id: p.tool_id != null ? String(p.tool_id) : null,
      exit_code: p.exit_code != null ? Number(p.exit_code) : null,
      ok: p.ok != null ? Boolean(p.ok) : null,
    };
  }
  if (kind === 'transition') {
    const state = event.state && typeof event.state === 'object' ? event.state : {};
    return {
      to_state: state.current_state != null ? String(state.current_state) : null,
    };
  }
  if (kind === 'usage.recorded') {
    const p = event.payload && typeof event.payload === 'object' ? event.payload : {};
    return {
      provider: p.provider != null ? String(p.provider) : null,
      model: p.model != null ? String(p.model) : null,
      usd: p.usd != null ? Number(p.usd) : null,
      cost_source: p.cost_source != null ? String(p.cost_source) : null,
    };
  }
  return {};
}

/**
 * @param {string} kind
 * @param {object} event
 * @param {object} payload
 */
function summarizeBody(kind, event, payload) {
  if (kind === 'tool.completed') {
    return `tool.completed tool_id=${payload.tool_id || '?'} exit_code=${
      payload.exit_code == null ? '?' : payload.exit_code
    }`;
  }
  if (kind === 'transition') {
    return `transition → ${payload.to_state || '?'}`;
  }
  if (kind === 'usage.recorded') {
    return `usage.recorded provider=${payload.provider || '?'} model=${payload.model || '?'}`;
  }
  return String(event.type || 'unknown');
}

/**
 * Stable content fingerprint for future dedupe (AE-031b).
 * @param {object} record
 */
function learningFingerprint(record) {
  const payload = {
    kind: record.kind,
    work_id: record.work_id,
    source_seq: record.source_seq,
    event_hash: record.event_hash,
    body: record.body,
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

module.exports = {
  LEARNING_KINDS,
  TRUST_VALUES,
  DEFAULT_TRUST,
  UNVERIFIED_CAPTURE_SOURCES,
  SCHEMA_PATH,
  loadSchema,
  validateLearningRecord,
  assertEvidenceRefs,
  promoteLearningTrust,
  learningRecordFromJournalEvent,
  learningFingerprint,
};
