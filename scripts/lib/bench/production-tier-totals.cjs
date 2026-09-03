'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  mergeTierTotals,
  emptyTierTotals,
  frontierTokenTotal,
  LADDER_TIERS,
} = require('./tier-totals.cjs');

function isDogfoodLiveWorkItem(name, state) {
  if (String(name).startsWith('live-mined-') || String(name).startsWith('live-ritual-')) return true;
  const history = Array.isArray(state?.history) ? state.history : [];
  return history.some((h) => h && h.actor === 'dogfood-live-worklogs');
}

function hasMuscleMemorySignal(state) {
  const tt = state.budget?.tier_totals;
  const hasDescentRecord = Boolean(state.metrics?.descent_recorded_at || state.metrics?.descent_tier);
  return (tt && typeof tt === 'object') || hasDescentRecord;
}

/**
 * Real /work pipeline items (not the holdout dogfood harness).
 * Does not require descent tier_totals — historical completed work often predates the ladder.
 */
function isOrganicPipelineWorkItem(name, state) {
  if (isDogfoodLiveWorkItem(name, state)) return false;
  const history = Array.isArray(state?.history) ? state.history : [];
  if (history.length < 2) return false;
  const reached =
    state.current_state === 'completed' ||
    history.some((h) => h && (h.to === 'pr-creation' || h.to === 'completed' || h.to === 'validation'));
  if (!reached) {
    return history.some((h) => h && h.to === 'implementation') && history.length >= 4;
  }
  return true;
}

/**
 * @param {string} worklogsRoot
 * @returns {{ dogfood: number, organic: number }}
 */
function countLiveWorklogKinds(worklogsRoot) {
  let dogfood = 0;
  let organic = 0;
  if (!fs.existsSync(worklogsRoot)) return { dogfood: 0, organic: 0 };
  for (const name of fs.readdirSync(worklogsRoot)) {
    const statePath = path.join(worklogsRoot, name, 'state.json');
    if (!fs.existsSync(statePath)) continue;
    let state;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      continue;
    }
    if (isDogfoodLiveWorkItem(name, state)) {
      if (hasMuscleMemorySignal(state)) dogfood++;
      continue;
    }
    if (isOrganicPipelineWorkItem(name, state) || hasMuscleMemorySignal(state)) organic++;
  }
  return { dogfood, organic };
}

/**
 * Organic /work items that count toward fleet learning but lack budget.tier_totals.
 * @param {string} projectRoot
 */
function auditOrganicTierTotals(projectRoot) {
  const worklogsRoot = path.join(path.resolve(projectRoot), '.worklogs');
  let organic = 0;
  let withTierTotals = 0;
  const missing = [];
  if (!fs.existsSync(worklogsRoot)) {
    return { organic: 0, with_tier_totals: 0, missing_work_ids: [] };
  }
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
    if (!isOrganicPipelineWorkItem(name, state) && !hasMuscleMemorySignal(state)) continue;
    organic++;
    if (state.budget?.tier_totals && typeof state.budget.tier_totals === 'object') {
      withTierTotals++;
    } else {
      missing.push(name);
    }
  }
  return { organic, with_tier_totals: withTierTotals, missing_work_ids: missing };
}

const FIXTURE_WORKLOGS = 'bench/fixtures/production-worklogs';
const ORGANIC_FIXTURE_WORKLOGS = 'bench/fixtures/organic-worklogs';

/**
 * @param {string} root absolute worklogs directory
 */
function aggregateFromWorklogsRoot(worklogsRoot) {
  let tierTotals = emptyTierTotals();
  let workItems = 0;

  if (!fs.existsSync(worklogsRoot)) {
    return { work_items: 0, tier_totals: tierTotals, frontier_tokens: 0 };
  }

  for (const name of fs.readdirSync(worklogsRoot)) {
    const statePath = path.join(worklogsRoot, name, 'state.json');
    if (!fs.existsSync(statePath)) continue;
    let state;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      continue;
    }
    const tt = state.budget?.tier_totals;
    const hasDescentRecord = Boolean(state.metrics?.descent_recorded_at || state.metrics?.descent_tier);
    if ((!tt || typeof tt !== 'object') && !hasDescentRecord) continue;
    if (tt && typeof tt === 'object') {
      tierTotals = mergeTierTotals(tierTotals, tt);
    }
    workItems++;
  }

  return {
    work_items: workItems,
    tier_totals: tierTotals,
    frontier_tokens: frontierTokenTotal(tierTotals),
    tiers_present: LADDER_TIERS.filter((t) => {
      const row = tierTotals[t];
      if (!row) return false;
      return Object.values(row).some((n) => Number(n) > 0);
    }),
  };
}

/**
 * Aggregate budget.tier_totals from live .worklogs and reproducible bench fixtures.
 * @param {string} projectRoot
 * @param {{ includeFixtures?: boolean }} [opts]
 */
function aggregateProductionTierTotals(projectRoot, opts = {}) {
  const includeFixtures = opts.includeFixtures !== false;
  const live = aggregateFromWorklogsRoot(path.join(projectRoot, '.worklogs'));
  const kinds = countLiveWorklogKinds(path.join(projectRoot, '.worklogs'));
  const organicFx = countLiveWorklogKinds(path.join(projectRoot, ORGANIC_FIXTURE_WORKLOGS));
  // `organic` is pack-root .worklogs only. Fixtures must not pad “team /work” counts.
  const organic = kinds.organic;
  if (!includeFixtures) {
    return {
      ...live,
      sources: {
        live: live.work_items,
        fixtures: 0,
        dogfood: kinds.dogfood,
        organic,
        organic_live: kinds.organic,
        organic_fixtures: organicFx.organic,
      },
    };
  }

  const fixture = aggregateFromWorklogsRoot(path.join(projectRoot, FIXTURE_WORKLOGS));
  return {
    work_items: live.work_items + fixture.work_items,
    tier_totals: mergeTierTotals(live.tier_totals, fixture.tier_totals),
    frontier_tokens: live.frontier_tokens + fixture.frontier_tokens,
    tiers_present: [...new Set([...(live.tiers_present || []), ...(fixture.tiers_present || [])])],
    sources: {
      live: live.work_items,
      fixtures: fixture.work_items,
      dogfood: kinds.dogfood,
      organic,
      organic_live: kinds.organic,
      organic_fixtures: organicFx.organic,
    },
  };
}

/**
 * Production portfolio multiplier from tier_totals vs cold baseline.
 * @param {object} production aggregateProductionTierTotals result
 * @param {{ policyCold?: number, policyWarm?: number, coldTierTokens?: number }} [opts]
 */
function productionPortfolioMultiplier(production, opts = {}) {
  const policyCold = opts.policyCold ?? 7700;
  const policyWarm = opts.policyWarm ?? 1750;
  const coldTier = opts.coldTierTokens ?? 200000;
  const n = Math.max(1, production.work_items);
  const warmTierPerItem = production.frontier_tokens / n;
  const coldPerTask = policyCold + coldTier;
  const warmPerTask = policyWarm + warmTierPerItem;
  return {
    cold_per_task_tokens: coldPerTask,
    warm_per_task_tokens: warmPerTask,
    portfolio_multiplier: warmPerTask / coldPerTask,
    frontier_tokens_per_item: warmTierPerItem,
  };
}

module.exports = {
  FIXTURE_WORKLOGS,
  ORGANIC_FIXTURE_WORKLOGS,
  isDogfoodLiveWorkItem,
  isOrganicPipelineWorkItem,
  hasMuscleMemorySignal,
  countLiveWorklogKinds,
  aggregateFromWorklogsRoot,
  aggregateProductionTierTotals,
  productionPortfolioMultiplier,
  auditOrganicTierTotals,
};
