'use strict';

const {
  loadMergedBudgetThresholds,
  getCounterCaps,
  projectRootFromWorkDir,
} = require('./budget-config.cjs');

/**
 * Single implementation of /check budget rules (commands/check.md + CLAUDE.md).
 * When ctx.pluginRoot + ctx.workDir are set, counter caps and subagent spawn cap
 * come from merged config (config/budget-thresholds.default.json + .agentic-swe/budget-thresholds.json + AGENTIC_SWE_BUDGET_THRESHOLDS).
 *
 * @param {object} state parsed state.json
 * @param {{ pluginRoot?: string, workDir?: string }} [ctx]
 * @returns {{ ok: boolean, verdict: 'PROCEED'|'STOP', errors: string[], details: object }}
 */
function checkBudgets(state, ctx = {}) {
  const errors = [];
  const budget = state.budget || {};
  const counters = state.counters || {};
  const risk = state.risk || {};

  const remaining =
    typeof budget.budget_remaining === 'number' ? budget.budget_remaining : NaN;
  if (!(remaining > 0)) {
    errors.push('iteration budget exhausted: budget.budget_remaining must be > 0');
  }

  const costUsed = typeof budget.cost_used === 'number' ? budget.cost_used : NaN;
  const costCap =
    typeof budget.cost_budget_usd === 'number' ? budget.cost_budget_usd : NaN;
  if (!(costUsed < costCap)) {
    errors.push('cost budget exhausted: budget.cost_used must be < budget.cost_budget_usd');
  }

  let counterCaps = null;
  if (ctx.pluginRoot && ctx.workDir) {
    const projectRoot = projectRootFromWorkDir(ctx.workDir);
    const merged = loadMergedBudgetThresholds(ctx.pluginRoot, projectRoot);
    counterCaps = getCounterCaps(merged, state);
  }

  const n = (k, fallbackMax) => {
    const v = counters[k];
    const num = typeof v === 'number' ? v : 0;
    const max =
      counterCaps && counterCaps[k] != null && Number.isFinite(Number(counterCaps[k]))
        ? Number(counterCaps[k])
        : fallbackMax;
    if (Number.isFinite(max) && num > max) errors.push(`counters.${k}=${num} exceeds max ${max}`);
  };

  n('lean_iter', 2);
  const designMax = counterCaps
    ? counterCaps._design_max_effective
    : risk.score != null && Number(risk.score) >= 4
      ? 4
      : 3;
  {
    const num = typeof counters.design_iter === 'number' ? counters.design_iter : 0;
    if (num > designMax) errors.push(`counters.design_iter=${num} exceeds max ${designMax}`);
  }
  n('code_iter', 5);
  n('merge_iter', 2);
  n('approval_iter', 3);
  n('self_review_iter', 1);
  n('test_adequacy_iter', 1);
  n('panel_runs', 1e9);
  n('subagent_spawns', 1e9);

  const verdict = errors.length === 0 ? 'PROCEED' : 'STOP';
  return {
    ok: errors.length === 0,
    verdict,
    errors,
    details: {
      budget_remaining: remaining,
      cost_used: costUsed,
      cost_budget_usd: costCap,
      design_iter_cap: designMax,
      counters: { ...counters },
    },
  };
}

module.exports = { checkBudgets };
