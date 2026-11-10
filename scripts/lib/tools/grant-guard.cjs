'use strict';

/**
 * F-M2-01: Grants must come only from the policy engine / approved authorization
 * state (runner opts, authorization-record.json). Caller-supplied tool input must
 * never carry authorization, permissions, or grant fields.
 */

const CALLER_GRANT_KEYS = ['authorized', 'permissions', 'grants', 'authorization'];

function callerGrantInjection(value) {
  if (!value || typeof value !== 'object') return null;
  for (const key of CALLER_GRANT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return key;
  }
  if (Array.isArray(value.args)) {
    for (const arg of value.args) {
      const nested = callerGrantInjection(arg);
      if (nested) return nested;
    }
  }
  return null;
}

/** Runner/PDP-supplied grants only (`context.opts.authorized`). Never read tool input. */
function authorizedFromContext(context) {
  const raw = context && context.opts && context.opts.authorized;
  if (!raw) return new Set();
  return raw instanceof Set ? raw : new Set(raw);
}

module.exports = { CALLER_GRANT_KEYS, callerGrantInjection, authorizedFromContext };
