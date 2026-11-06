'use strict';

const crypto = require('node:crypto');

/**
 * Canonical JSON: sort object keys recursively; arrays keep order.
 * @param {unknown} value
 * @returns {string}
 */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/**
 * Stable sha256 of a merged policy object (hex).
 * @param {object} policy
 * @returns {string}
 */
function policyDigest(policy) {
  const body = canonicalJson(policy && typeof policy === 'object' ? policy : {});
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

module.exports = { canonicalJson, policyDigest };
