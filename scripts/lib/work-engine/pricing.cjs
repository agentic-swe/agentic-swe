'use strict';

/**
 * USD per million tokens (Anthropic list pricing, Feb 2026 snapshot).
 * Override with AGENTIC_SWE_PRICING_JSON pointing at JSON:
 * { "sonnet": { "inputPerMtok": 3, "outputPerMtok": 15, "cacheWritePerMtok": 3.75, "cacheReadPerMtok": 0.30 }, ... }
 *
 * Model id resolution: longest key in overrides that is a substring of modelId (lowercased), else tier match.
 */

const TIERS = {
  sonnet: {
    inputPerMtok: 3,
    outputPerMtok: 15,
    cacheWritePerMtok: 3.75,
    cacheReadPerMtok: 0.3,
  },
  opus: {
    inputPerMtok: 5,
    outputPerMtok: 25,
    cacheWritePerMtok: 6.25,
    cacheReadPerMtok: 0.5,
  },
  haiku: {
    inputPerMtok: 1,
    outputPerMtok: 5,
    cacheWritePerMtok: 1.25,
    cacheReadPerMtok: 0.1,
  },
};

function tierForModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return 'sonnet';
  const m = modelId.toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('opus')) return 'opus';
  return 'sonnet';
}

function loadOverrides() {
  const p = process.env.AGENTIC_SWE_PRICING_JSON;
  if (!p || !require('node:fs').existsSync(p)) return null;
  try {
    return JSON.parse(require('node:fs').readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

let overridesCache;

function getRates(modelId) {
  if (overridesCache === undefined) overridesCache = loadOverrides();
  if (overridesCache && typeof overridesCache === 'object') {
    const m = String(modelId || '').toLowerCase();
    let best = null;
    let bestLen = -1;
    for (const key of Object.keys(overridesCache)) {
      if (key === 'default') continue;
      if (m.includes(key.toLowerCase()) && key.length > bestLen) {
        best = overridesCache[key];
        bestLen = key.length;
      }
    }
    if (best && typeof best === 'object') return normalizeRateTable(best);
    if (overridesCache.default) return normalizeRateTable(overridesCache.default);
  }
  const tier = tierForModel(modelId);
  return { ...TIERS[tier] };
}

function normalizeRateTable(t) {
  return {
    inputPerMtok: Number(t.inputPerMtok),
    outputPerMtok: Number(t.outputPerMtok),
    cacheWritePerMtok: Number(t.cacheWritePerMtok ?? t.cacheCreationPerMtok ?? 0),
    cacheReadPerMtok: Number(t.cacheReadPerMtok ?? 0),
  };
}

/**
 * @param {object} usage Anthropic-style usage on a message
 * @param {string} [modelId]
 * @returns {number} USD for this usage object (not rounded aggressively)
 */
function usdForUsage(usage, modelId) {
  if (!usage || typeof usage !== 'object') return 0;
  const r = getRates(modelId);
  const it = Number(usage.input_tokens || 0);
  const ot = Number(usage.output_tokens || 0);
  const cr = Number(usage.cache_read_input_tokens || 0);
  const cw = Number(usage.cache_creation_input_tokens || 0);
  return (
    (it * r.inputPerMtok + ot * r.outputPerMtok + cr * r.cacheReadPerMtok + cw * r.cacheWritePerMtok) / 1e6
  );
}

module.exports = { usdForUsage, getRates, tierForModel, TIERS };
