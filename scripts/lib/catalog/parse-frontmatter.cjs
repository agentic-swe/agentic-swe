'use strict';

/**
 * Extract YAML-like frontmatter between first two --- lines.
 * Accepts LF or CRLF so Windows checkouts still lint.
 * @param {string} content
 * @returns {{ block: string, body: string } | null}
 */
function extractFrontmatter(content) {
  if (typeof content !== 'string') return null;
  const normalized = content.replace(/^\uFEFF/, '');
  const crlf = normalized.startsWith('---\r\n');
  const lf = normalized.startsWith('---\n');
  if (!crlf && !lf) return null;
  const nl = crlf ? '\r\n' : '\n';
  const open = `---${nl}`;
  const close = `${nl}---${nl}`;
  const end = normalized.indexOf(close, open.length);
  if (end === -1) return null;
  return {
    block: normalized.slice(open.length, end).replace(/\r\n/g, '\n'),
    body: normalized.slice(end + close.length),
  };
}

/**
 * Parse simple key: value lines. Supports description: "quoted string" on one line.
 * @param {string} block
 * @returns {Record<string, string>}
 */
function parseSimpleFields(block) {
  const out = {};
  for (const line of block.split('\n')) {
    const m = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1);
    } else {
      val = val.trim();
    }
    out[key] = val;
  }
  return out;
}

const ALLOWED_MODELS = new Set(['fast', 'balanced', 'heavy', 'frontier']);
const LEGACY_MODELS = new Set(['sonnet', 'opus', 'haiku']);

/** @param {string} model */
function normalizeModelTier(model) {
  const m = String(model || '').trim();
  if (ALLOWED_MODELS.has(m)) return m;
  const legacy = { haiku: 'fast', sonnet: 'balanced', opus: 'heavy' };
  if (legacy[m]) return legacy[m];
  return m;
}

module.exports = {
  extractFrontmatter,
  parseSimpleFields,
  ALLOWED_MODELS,
  LEGACY_MODELS,
  normalizeModelTier,
};
