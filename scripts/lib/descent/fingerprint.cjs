'use strict';

const crypto = require('node:crypto');

/**
 * Fingerprint keys on file-set + verify command + failure signature (NOT task intent).
 * @param {{ files: string[], verifyCommand: string, failureSignature?: string|null }} input
 * @returns {string}
 */
function buildFingerprint(input) {
  const files = [...(input.files || [])].map((f) => f.replace(/\\/g, '/')).sort();
  const verify = String(input.verifyCommand || '').trim();
  const fail = String(input.failureSignature || '').trim();
  const payload = JSON.stringify({ files, verify, fail });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

module.exports = { buildFingerprint };
