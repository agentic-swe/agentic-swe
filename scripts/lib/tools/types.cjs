'use strict';

const crypto = require('node:crypto');
const { redactSecrets } = require('../shared/redact.cjs');

function idempotencyKey(toolId, input, explicit) {
  if (explicit) return String(explicit);
  return crypto
    .createHash('sha256')
    .update(`${toolId}:${JSON.stringify(canonical(input || {}))}`)
    .digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function normalizedResult(fields = {}) {
  return {
    status: 'error',
    pending_approval: false,
    tool_id: '',
    tool_version: '',
    idempotency_key: '',
    duration_ms: 0,
    policy_decision_ref: null,
    partial: false,
    effects: 'none',
    ...fields,
  };
}

function redactText(value) {
  return redactSecrets(String(value == null ? '' : value)).redacted;
}

module.exports = { canonical, idempotencyKey, normalizedResult, redactText };
