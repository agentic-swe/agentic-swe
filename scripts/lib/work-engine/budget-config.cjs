'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJsonIfExists(p) {
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function deepMerge(base, overlay) {
  if (!overlay || typeof overlay !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(overlay)) {
    const v = overlay[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * @param {string} pluginRoot pack root (contains config/budget-thresholds.default.json)
 * @param {string} [projectRoot] target repo root (parent of .worklogs); optional .agentic-swe/budget-thresholds.json merged
 */
function loadMergedBudgetThresholds(pluginRoot, projectRoot) {
  const defPath = path.join(pluginRoot, 'config', 'budget-thresholds.default.json');
  let merged = readJsonIfExists(defPath);
  if (!merged || typeof merged !== 'object') {
    merged = { schema_version: 1, tracks: {}, counter_caps: {}, subagents: {} };
  }

  const envPath = process.env.AGENTIC_SWE_BUDGET_THRESHOLDS;
  const envOverlay = readJsonIfExists(envPath);
  if (envOverlay) merged = deepMerge(merged, envOverlay);

  if (projectRoot) {
    const local = readJsonIfExists(path.join(projectRoot, '.agentic-swe', 'budget-thresholds.json'));
    if (local) merged = deepMerge(merged, local);
  }

  return merged;
}

/**
 * @param {string|null|undefined} track
 */
function normalizeTrackKey(track) {
  if (track === 'lean' || track === 'standard' || track === 'rigorous') return track;
  return 'rigorous';
}

/**
 * @param {object} merged from loadMergedBudgetThresholds
 * @param {string} track lean|standard|rigorous
 */
function trackBudgetDefaults(merged, track) {
  const t = normalizeTrackKey(track);
  const tr = (merged.tracks && merged.tracks[t]) || (merged.tracks && merged.tracks.rigorous) || {};
  return {
    iteration_budget: Number(tr.iteration_budget),
    cost_budget_usd: Number(tr.cost_budget_usd),
  };
}

/**
 * Apply track ceilings and policy object onto state (mutates).
 * Caps budget_remaining to new iteration_budget when updateMoney is true.
 * @param {object} state
 * @param {string|null|undefined} track
 * @param {object} merged
 * @param {{ updateMoney?: boolean }} [opts] defaults { updateMoney: true }
 */
function applyTrackBudgetProfile(state, track, merged, opts = {}) {
  const updateMoney = opts.updateMoney !== false;
  if (!state.budget) state.budget = {};
  if (updateMoney) {
    const caps = trackBudgetDefaults(merged, track);
    if (Number.isFinite(caps.iteration_budget)) {
      state.budget.iteration_budget = caps.iteration_budget;
      const rem =
        typeof state.budget.budget_remaining === 'number'
          ? state.budget.budget_remaining
          : caps.iteration_budget;
      state.budget.budget_remaining = Math.min(rem, caps.iteration_budget);
    }
    if (Number.isFinite(caps.cost_budget_usd)) {
      state.budget.cost_budget_usd = caps.cost_budget_usd;
    }
  }
  const sub = merged.subagents || {};
  state.budget.policy = {
    subagent_skip_below_budget_remaining: Number.isFinite(Number(sub.skip_auto_select_below_budget_remaining))
      ? Number(sub.skip_auto_select_below_budget_remaining)
      : 3,
    max_spawns_per_phase: Number.isFinite(Number(sub.max_spawns_per_phase))
      ? Number(sub.max_spawns_per_phase)
      : 2,
    max_delegation_per_agent_per_phase: Number.isFinite(Number(sub.max_delegation_per_agent_per_phase))
      ? Number(sub.max_delegation_per_agent_per_phase)
      : 1,
  };
  if (updateMoney) {
    state.budget.policy.budget_profile_track = normalizeTrackKey(track);
  }
}

/**
 * Counter caps for checkBudgets (with risk-based design cap).
 * @param {object} merged
 * @param {object} state
 */
function getCounterCaps(merged, state) {
  const raw = { ...(merged.counter_caps || {}) };
  const risk = state.risk || {};
  const scoreTh = Number(raw.design_iter_high_risk_min_score ?? 4);
  const designNormal = Number(raw.design_iter ?? 3);
  const designHigh = Number(raw.design_iter_high_risk ?? 4);
  const designMax =
    risk.score != null && Number(risk.score) >= scoreTh ? designHigh : designNormal;
  const caps = { ...raw };
  delete caps.design_iter;
  delete caps.design_iter_high_risk;
  delete caps.design_iter_high_risk_min_score;
  caps._design_max_effective = Number.isFinite(designMax) ? designMax : 3;
  return caps;
}

/** Project root: .../repo from workDir .../repo/.worklogs/id */
function projectRootFromWorkDir(workDir) {
  const abs = path.resolve(workDir);
  const logs = path.dirname(abs);
  if (path.basename(logs) !== '.worklogs') return null;
  return path.dirname(logs);
}

module.exports = {
  loadMergedBudgetThresholds,
  trackBudgetDefaults,
  applyTrackBudgetProfile,
  getCounterCaps,
  projectRootFromWorkDir,
  normalizeTrackKey,
  deepMerge,
};
