'use strict';

/**
 * Dated price table for known Anthropic models (Nov 2026 snapshot).
 * NEVER falls back to work-engine/pricing.cjs tier defaults.
 * Unknown non-local models → usd: null, cost_source: 'unknown'.
 */

/** @type {Record<string, { inputPerMtok: number, outputPerMtok: number, cacheReadPerMtok?: number, as_of: string }>} */
const PRICE_TABLE = {
  'claude-sonnet-4-20250514': {
    inputPerMtok: 3,
    outputPerMtok: 15,
    cacheReadPerMtok: 0.3,
    as_of: '2026-11-01',
  },
  'claude-3-5-haiku-20241022': {
    inputPerMtok: 1,
    outputPerMtok: 5,
    cacheReadPerMtok: 0.1,
    as_of: '2026-11-01',
  },
  'claude-opus-4-20250514': {
    inputPerMtok: 5,
    outputPerMtok: 25,
    cacheReadPerMtok: 0.5,
    as_of: '2026-11-01',
  },
};

/**
 * @param {{
 *   provider: string,
 *   model: string,
 *   input?: number|null,
 *   output?: number|null,
 *   cache_read?: number|null,
 *   local?: boolean,
 *   provider_usd?: number|null,
 * }} args
 * @returns {{ usd: number|null, cost_source: 'local'|'price_table'|'provider'|'unknown' }}
 */
function resolveCost(args) {
  const provider = String(args.provider || '');
  const model = String(args.model || '');
  const isLocal =
    args.local === true ||
    provider === 'fixture' ||
    provider === 'ollama' ||
    provider === 'llama.cpp' ||
    provider === 'llamacpp';

  if (isLocal) {
    return { usd: 0, cost_source: 'local' };
  }

  if (args.provider_usd != null && Number.isFinite(Number(args.provider_usd))) {
    return { usd: Number(args.provider_usd), cost_source: 'provider' };
  }

  const rates = PRICE_TABLE[model];
  if (rates) {
    const it = args.input == null ? 0 : Number(args.input);
    const ot = args.output == null ? 0 : Number(args.output);
    const cr = args.cache_read == null ? 0 : Number(args.cache_read);
    if (![it, ot, cr].every((n) => Number.isFinite(n))) {
      return { usd: null, cost_source: 'unknown' };
    }
    const usd =
      (it * rates.inputPerMtok +
        ot * rates.outputPerMtok +
        cr * (rates.cacheReadPerMtok || 0)) /
      1e6;
    return { usd: Number(usd.toFixed(8)), cost_source: 'price_table' };
  }

  return { usd: null, cost_source: 'unknown' };
}

function priceTableKeys() {
  return Object.keys(PRICE_TABLE);
}

module.exports = { resolveCost, PRICE_TABLE, priceTableKeys };
