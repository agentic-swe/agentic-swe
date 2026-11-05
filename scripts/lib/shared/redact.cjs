'use strict';

const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|passwd|authorization)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+=]{8,}/gi,
  /sk-[A-Za-z0-9]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /(?:github_pat_|gho_|ghu_|ghs_|ghr_|glpat-)[A-Za-z0-9_\-]{20,}/g,
  /npm_[A-Za-z0-9]{36}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp):\/\/\S+/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----/g,
];

const PROSE_SECRET =
  /((?:api[_-]?key|client[_-]?secret|secret|token|password|passwd)\s+is\s+)(\S+)/gi;

function looksLikeCredential(value) {
  if (value.length < 8) return false;
  if (/\d/.test(value) || /[-_]/.test(value) || value.length >= 20) return true;
  return false;
}

/**
 * @param {string} text
 * @returns {{ redacted: string, hits: number }}
 */
function redactSecrets(text) {
  let redacted = String(text ?? '');
  let hits = 0;
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    redacted = redacted.replace(re, () => {
      hits++;
      return '[REDACTED]';
    });
  }
  PROSE_SECRET.lastIndex = 0;
  redacted = redacted.replace(PROSE_SECRET, (full, prefix, value) => {
    const cleaned = value.replace(/[.,;:)]+$/, '');
    const suffix = value.slice(cleaned.length);
    if (!looksLikeCredential(cleaned)) return full;
    hits++;
    return `${prefix}[REDACTED]${suffix}`;
  });
  return { redacted, hits };
}

/**
 * Redact secrets in every string of a JSON-like value.
 * @param {unknown} value
 * @returns {unknown}
 */
function redactDeep(value) {
  if (typeof value === 'string') return redactSecrets(value).redacted;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = redactDeep(item);
    return out;
  }
  return value;
}

module.exports = { redactSecrets, redactDeep };
