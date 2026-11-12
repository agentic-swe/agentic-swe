'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_PATH = path.join(__dirname, '..', '..', '..', 'schemas', 'journal-event.schema.json');

/** @type {Map<string, { kind: 'snapshot' | 'side', schema?: object, prefix?: boolean }>} */
const REGISTRY = new Map();

const SNAPSHOT_TYPES = [
  'init',
  'transition',
  'spawn',
  'review.recorded',
  'review.failed',
  'approve',
  'track-waiver',
  'github.verified',
  'history.imported',
  'test.seed',
  'executor.starting',
];

const SIDE_PAYLOAD_KEYS = {
  'lease.reclaimed': 'leaseReclaimedPayload',
  'policy.decided': 'policyDecidedPayload',
  'usage.recorded': 'usageRecordedPayload',
  'tool.requested': 'toolRequestedPayload',
  'tool.completed': 'toolCompletedPayload',
  'tool.reconciled': 'toolReconciledPayload',
  'runtime.step': null,
  'runtime.critical_failure': null,
  // AE-027b: process-sandbox isolation harness outcomes (additive; not PDP baseline).
  'sandbox.isolation.passed': null,
  'sandbox.isolation.failed': null,
  'test.side': 'testSidePayload',
  'github.anchored': null,
};

let schemaDoc = null;
/** @type {Map<string, Function>} */
const validators = new Map();

function loadSchemaDoc() {
  if (schemaDoc) return schemaDoc;
  schemaDoc = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return schemaDoc;
}

function compilePayloadValidator(defKey) {
  if (validators.has(defKey)) return validators.get(defKey);
  const Ajv = require('ajv').default;
  const ajv = new Ajv({ allErrors: true, strict: false });
  const doc = loadSchemaDoc();
  const schema = doc.definitions && doc.definitions[defKey];
  if (!schema) {
    const err = new Error(`missing payload schema definition: ${defKey}`);
    err.code = 'EVENT_INVALID';
    throw err;
  }
  const validate = ajv.compile(schema);
  validators.set(defKey, validate);
  return validate;
}

function registerEventType(type, opts = {}) {
  if (!type || typeof type !== 'string') {
    throw new Error('event type must be a non-empty string');
  }
  const kind = opts.kind === 'side' ? 'side' : 'snapshot';
  REGISTRY.set(type, {
    kind,
    schemaKey: opts.schemaKey || null,
    prefix: Boolean(opts.prefix),
  });
}

function ensureDefaults() {
  if (REGISTRY.size) return;
  for (const type of SNAPSHOT_TYPES) {
    registerEventType(type, { kind: 'snapshot' });
  }
  registerEventType('dispatch.', { kind: 'snapshot', prefix: true });
  for (const [type, schemaKey] of Object.entries(SIDE_PAYLOAD_KEYS)) {
    registerEventType(type, { kind: 'side', schemaKey });
  }
}

function lookup(type) {
  ensureDefaults();
  if (REGISTRY.has(type)) return { type, ...REGISTRY.get(type) };
  for (const [key, meta] of REGISTRY) {
    if (meta.prefix && type.startsWith(key)) return { type, ...meta };
  }
  return null;
}

function isSnapshotType(type) {
  const meta = lookup(type);
  return Boolean(meta && meta.kind === 'snapshot');
}

function isSideType(type) {
  const meta = lookup(type);
  return Boolean(meta && meta.kind === 'side');
}

function eventInvalid(message) {
  const err = new Error(message);
  err.code = 'EVENT_INVALID';
  return err;
}

/**
 * Validate a side-event payload (or soft-check snapshot presence).
 * @param {string} type
 * @param {unknown} payload
 * @returns {{ ok: true } | { ok: false, code: 'EVENT_INVALID', message: string }}
 */
function validateEvent(type, payload) {
  const meta = lookup(type);
  if (!meta) {
    return { ok: false, code: 'EVENT_INVALID', message: `unregistered event type: ${type}` };
  }
  if (meta.kind === 'snapshot') {
    if (payload != null && (typeof payload !== 'object' || Array.isArray(payload))) {
      return { ok: false, code: 'EVENT_INVALID', message: `snapshot type ${type} requires an object state` };
    }
    return { ok: true };
  }
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, code: 'EVENT_INVALID', message: `side event ${type} requires an object payload` };
  }
  if (!meta.schemaKey) return { ok: true };
  try {
    const validate = compilePayloadValidator(meta.schemaKey);
    if (validate(payload)) return { ok: true };
    const detail = (validate.errors || [])
      .map((e) => `${e.instancePath || '/'} ${e.message}`)
      .join('; ');
    return { ok: false, code: 'EVENT_INVALID', message: `payload failed schema for ${type}: ${detail}` };
  } catch (err) {
    return { ok: false, code: 'EVENT_INVALID', message: err.message || String(err) };
  }
}

function assertValidEvent(type, payload) {
  const result = validateEvent(type, payload);
  if (!result.ok) throw eventInvalid(result.message);
  return result;
}

module.exports = {
  SCHEMA_PATH,
  registerEventType,
  isSnapshotType,
  isSideType,
  lookup,
  validateEvent,
  assertValidEvent,
  ensureDefaults,
};
