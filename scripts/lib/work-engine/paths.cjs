'use strict';

const path = require('node:path');

/**
 * Resolve a user-supplied evidence ref to an absolute path under workDir.
 * Rejects .., absolute paths outside workDir, and null bytes.
 * @param {string} workDir absolute
 * @param {string} ref relative path from work dir (posix-style ok)
 * @returns {{ ok: true, resolved: string } | { ok: false, error: string }}
 */
function resolveEvidenceRef(workDir, ref) {
  if (typeof ref !== 'string' || ref.length === 0) {
    return { ok: false, error: 'evidence ref must be non-empty string' };
  }
  if (ref.includes('\0')) {
    return { ok: false, error: 'evidence ref contains null byte' };
  }
  const normalized = ref.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    return { ok: false, error: 'evidence ref must be relative' };
  }
  const segments = normalized.split('/').filter((s) => s.length > 0);
  if (segments.some((s) => s === '..')) {
    return { ok: false, error: 'evidence ref must not contain ..' };
  }
  const resolved = path.resolve(workDir, ...segments);
  const workResolved = path.resolve(workDir);
  if (resolved !== workResolved && !resolved.startsWith(workResolved + path.sep)) {
    return { ok: false, error: 'evidence ref escapes work directory' };
  }
  return { ok: true, resolved };
}

module.exports = { resolveEvidenceRef };
