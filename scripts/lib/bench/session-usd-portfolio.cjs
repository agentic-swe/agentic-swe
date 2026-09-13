'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadTierTokenEstimates } = require('../descent/ladder.cjs');
const { historicalSessionAccounting, usdForWarmTokens } = require('../descent/historical-session.cjs');
const {
  isDogfoodLiveWorkItem,
  isOrganicPipelineWorkItem,
} = require('./production-tier-totals.cjs');

const POLICY_WARM = 1750;
const TARGET = 0.02;

/**
 * Infer replay tier from work-item metrics (no ladder re-run).
 * @param {object} state
 * @param {Record<string, number>} estimates
 */
function inferReplayTier(state, estimates) {
  const recorded = state.metrics?.descent_tier;
  if (recorded && estimates[recorded] != null) return recorded;
  const tt = state.budget?.tier_totals;
  if (tt && typeof tt === 'object') {
    let best = null;
    let bestTok = Infinity;
    for (const tier of ['L0', 'L1', 'L2']) {
      const row = tt[tier];
      if (!row) continue;
      const sum = Object.values(row).reduce((s, n) => s + Number(n || 0), 0);
      if (sum > 0 && estimates[tier] < bestTok) {
        bestTok = estimates[tier];
        best = tier;
      }
    }
    if (best) return best;
  }
  return 'L3';
}

/**
 * Live organic /work session USD: warm verify-replay vs billed historical session.
 * Pack-root `.worklogs` only — never bench fixtures.
 *
 * @param {string} projectRoot
 * @param {string} pluginRoot
 */
function aggregateOrganicSessionUsd(projectRoot, pluginRoot) {
  const estimates = loadTierTokenEstimates(pluginRoot);
  const worklogsRoot = path.join(path.resolve(projectRoot), '.worklogs');
  const items = [];

  if (fs.existsSync(worklogsRoot)) {
    for (const name of fs.readdirSync(worklogsRoot)) {
      const statePath = path.join(worklogsRoot, name, 'state.json');
      if (!fs.existsSync(statePath)) continue;
      let state;
      try {
        state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      } catch {
        continue;
      }
      if (isDogfoodLiveWorkItem(name, state)) continue;
      if (!isOrganicPipelineWorkItem(name, state)) continue;

      const session = historicalSessionAccounting(state);
      if (!session.has_session) {
        items.push({ work_id: name, has_session: false });
        continue;
      }

      const tier = inferReplayTier(state, estimates);
      const delivered = estimates[tier] ?? estimates.L3;
      const warmTokens = POLICY_WARM + delivered;
      const session_usd_warm = usdForWarmTokens(warmTokens);
      const session_usd_multiplier = session.usd > 0 ? session_usd_warm / session.usd : null;

      items.push({
        work_id: name,
        has_session: true,
        tier,
        delivered_tokens: delivered,
        session_usd: session.usd,
        session_usd_warm,
        session_usd_multiplier,
      });
    }
  }

  const billed = items.filter((i) => i.has_session && i.session_usd_multiplier != null);
  const session_usd_multiplier =
    billed.length === 0
      ? null
      : billed.reduce((s, i) => s + i.session_usd_multiplier, 0) / billed.length;

  return {
    measurement_contract:
      'Billed verify-replay (policy warm + inferred descent tier) vs historical cost_used/usage_totals. Not a new-feature design session.',
    items,
    summary: {
      organic_items: items.length,
      billed_sessions: billed.length,
      session_usd_multiplier,
      target_multiplier: TARGET,
      usd_target_met: session_usd_multiplier == null ? null : session_usd_multiplier <= TARGET,
    },
  };
}

module.exports = { aggregateOrganicSessionUsd, inferReplayTier, POLICY_WARM, TARGET };
