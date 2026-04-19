'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('os');
const path = require('node:path');
const { checkBudgets } = require('../scripts/lib/work-engine/budget.cjs');
const {
  loadMergedBudgetThresholds,
  applyTrackBudgetProfile,
  deepMerge,
  projectRootFromWorkDir,
} = require('../scripts/lib/work-engine/budget-config.cjs');

const pluginRoot = path.join(__dirname, '..');

describe('budget thresholds config', () => {
  it('deepMerge overlays tracks', () => {
    const a = { tracks: { lean: { iteration_budget: 12 } } };
    const b = { tracks: { lean: { cost_budget_usd: 9 } } };
    const m = deepMerge(a, b);
    assert.strictEqual(m.tracks.lean.iteration_budget, 12);
    assert.strictEqual(m.tracks.lean.cost_budget_usd, 9);
  });

  it('applyTrackBudgetProfile updates money and policy', () => {
    const merged = loadMergedBudgetThresholds(pluginRoot, null);
    const state = {
      budget: { iteration_budget: 10, budget_remaining: 10, cost_budget_usd: 3, cost_used: 0 },
      pipeline: { track: 'lean' },
    };
    applyTrackBudgetProfile(state, 'lean', merged, { updateMoney: true });
    assert.strictEqual(state.budget.iteration_budget, merged.tracks.lean.iteration_budget);
    assert.ok(state.budget.policy.subagent_skip_below_budget_remaining >= 1);
  });

  it('checkBudgets enforces subagent_spawns from config when ctx provided', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-bt-'));
    const workDir = path.join(tmpRoot, '.worklogs', 'wid');
    fs.mkdirSync(workDir, { recursive: true });
    const state = {
      budget: { iteration_budget: 10, budget_remaining: 5, cost_budget_usd: 10, cost_used: 0 },
      counters: { subagent_spawns: 999, lean_iter: 0, design_iter: 0, code_iter: 0, merge_iter: 0, approval_iter: 0, self_review_iter: 0, test_adequacy_iter: 0, panel_runs: 0 },
      risk: { score: null },
    };
    const r = checkBudgets(state, { pluginRoot, workDir });
    assert.strictEqual(r.ok, false);
    assert.match(r.errors.join(' '), /subagent_spawns/);
  });

  it('projectRootFromWorkDir resolves parent of .worklogs', () => {
    const pr = projectRootFromWorkDir('/proj/.worklogs/foo');
    assert.strictEqual(pr, path.resolve('/proj'));
  });
});
