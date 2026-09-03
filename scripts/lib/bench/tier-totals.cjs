'use strict';

const { tierForModel } = require('../work-engine/pricing.cjs');

const LADDER_TIERS = ['L0', 'L1', 'L2', 'L3'];

const USAGE_KEYS = [
  'input_tokens',
  'output_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
];

/**
 * Map Anthropic-style model id to execution ladder tier for token attribution.
 * L0 is never assigned from transcript rows (zero-token deterministic work).
 */
function ladderTierForModel(modelId) {
  const t = tierForModel(modelId);
  if (t === 'opus') return 'L3';
  if (t === 'haiku') return 'L2';
  return 'L2';
}

function emptyTierTotals() {
  const o = {};
  for (const tier of LADDER_TIERS) {
    o[tier] = {};
    for (const k of USAGE_KEYS) o[tier][k] = 0;
  }
  return o;
}

function addUsageToTierTotals(tierTotals, ladderTier, usage) {
  if (!tierTotals[ladderTier]) {
    tierTotals[ladderTier] = {};
    for (const k of USAGE_KEYS) tierTotals[ladderTier][k] = 0;
  }
  for (const k of USAGE_KEYS) {
    const n = Number(usage[k]);
    if (Number.isFinite(n)) {
      tierTotals[ladderTier][k] = (tierTotals[ladderTier][k] || 0) + n;
    }
  }
}

function mergeTierTotals(base, delta) {
  const out = base && typeof base === 'object' ? JSON.parse(JSON.stringify(base)) : emptyTierTotals();
  for (const tier of LADDER_TIERS) {
    if (!out[tier]) out[tier] = {};
    for (const k of USAGE_KEYS) {
      const add = delta?.[tier]?.[k] || 0;
      out[tier][k] = Number((Number(out[tier][k] || 0) + add).toFixed(0));
    }
  }
  return out;
}

/** Sum frontier-tier (L3) input+output tokens for headline metric. */
function frontierTokenTotal(tierTotals) {
  if (!tierTotals?.L3) return 0;
  const l3 = tierTotals.L3;
  return (l3.input_tokens || 0) + (l3.output_tokens || 0);
}

module.exports = {
  LADDER_TIERS,
  USAGE_KEYS,
  ladderTierForModel,
  emptyTierTotals,
  addUsageToTierTotals,
  mergeTierTotals,
  frontierTokenTotal,
};
