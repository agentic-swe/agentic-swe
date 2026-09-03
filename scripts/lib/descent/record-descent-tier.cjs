'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadTierTokenEstimates } = require('./ladder.cjs');
const { addUsageToTierTotals, mergeTierTotals, emptyTierTotals } = require('../bench/tier-totals.cjs');
const { withWriteLockSync } = require('../work-engine/state-lock.cjs');

/**
 * Map descent ladder result to synthetic usage for tier_totals attribution.
 * @param {string} tier L0|L1|L2|L3
 * @param {object} tierEstimates
 */
function usageForDescentTier(tier, tierEstimates) {
  const tokens = tierEstimates[tier] ?? tierEstimates.L3 ?? 200000;
  return {
    input_tokens: tokens,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
}

/**
 * Record descent ladder tier delivery into work item budget.tier_totals.
 * @param {{ workDir: string, pluginRoot: string, tier: string, hit?: boolean, source?: string }} opts
 */
function recordDescentTierUsage(opts) {
  const workDir = path.resolve(opts.workDir);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const statePath = path.join(workDir, 'state.json');
  if (!fs.existsSync(statePath)) {
    return { ok: false, reason: 'state.json missing' };
  }

  const tier = opts.tier || 'L3';
  const hit = opts.hit !== false;
  const effectiveTier = hit ? tier : 'L3';
  const estimates = loadTierTokenEstimates(pluginRoot);
  const usage = usageForDescentTier(effectiveTier, estimates);

  return withWriteLockSync(workDir, () => {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.budget = state.budget || {};
    const base = state.budget.tier_totals || emptyTierTotals();
    const delta = emptyTierTotals();
    addUsageToTierTotals(delta, effectiveTier, usage);
    state.budget.tier_totals = mergeTierTotals(base, delta);
    state.metrics = state.metrics || {};
    state.metrics.descent_tier = effectiveTier;
    state.metrics.descent_hit = hit;
    state.metrics.descent_recorded_at = new Date().toISOString();
    if (opts.source) state.metrics.descent_source = opts.source;
    if (opts.metricsPatch && typeof opts.metricsPatch === 'object') {
      Object.assign(state.metrics, opts.metricsPatch);
    }
    state.updated_at = state.metrics.descent_recorded_at;
    const tmp = `${statePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, statePath);
    return {
      ok: true,
      tier: effectiveTier,
      input_tokens: usage.input_tokens,
      tier_totals: state.budget.tier_totals,
    };
  });
}

module.exports = {
  usageForDescentTier,
  recordDescentTierUsage,
};
