'use strict';

/**
 * Extract YAML-like frontmatter between first two --- lines.
 * @param {string} content
 * @returns {{ block: string, body: string } | null}
 */
function extractFrontmatter(content) {
  if (typeof content !== 'string' || !content.startsWith('---\n')) return null;
  const end = content.indexOf('\n---\n', 4);
  if (end === -1) return null;
  return {
    block: content.slice(4, end),
    body: content.slice(end + 5),
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
