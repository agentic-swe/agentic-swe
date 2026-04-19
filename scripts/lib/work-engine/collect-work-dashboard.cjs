'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseIsoMs(s) {
  const t = Date.parse(String(s || ''));
  return Number.isFinite(t) ? t : null;
}

const HISTORY_SCAN_CAP = 500;

function sumUsageTotals(totals) {
  if (!totals || typeof totals !== 'object') return 0;
  let n = 0;
  for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
    const v = Number(totals[k]);
    if (Number.isFinite(v)) n += v;
  }
  return n;
}

/**
 * Last N history entries with destination state (for dashboard timeline).
 * @param {unknown} hist
 * @param {number} [limit]
 * @returns {{ at: string|null, to: string }[]}
 */
function recentTransitionsFromHistory(hist, limit = 12) {
  if (!Array.isArray(hist)) return [];
  const withTo = hist.filter((e) => e && typeof e === 'object' && e.to != null);
  const slice = withTo.slice(-limit);
  return slice.map((e) => ({
    at: e.at != null ? String(e.at) : e.timestamp != null ? String(e.timestamp) : null,
    to: String(e.to),
  }));
}

/**
 * Count transitions to each `to` state (scans at most last HISTORY_SCAN_CAP entries).
 * @param {unknown} hist
 * @returns {Record<string, number>}
 */
function stateHistogramFromHistory(hist) {
  const counts = {};
  if (!Array.isArray(hist)) return counts;
  const n = Math.min(hist.length, HISTORY_SCAN_CAP);
  const start = Math.max(0, hist.length - n);
  for (let i = start; i < hist.length; i++) {
    const e = hist[i];
    if (e && typeof e === 'object' && e.to != null) {
      const k = String(e.to);
      counts[k] = (counts[k] || 0) + 1;
    }
  }
  return counts;
}

/** Display path under project root (forward slashes). */
function workDirRelative(dirId) {
  return `.worklogs/${dirId}`.replace(/\\/g, '/');
}

const DASHBOARD_PAGE_LIMIT_MAX = 200;

/**
 * Read-only scan of each `.worklogs/<id>/state.json` under the project (local dashboard).
 * @param {string} cwd project root (parent of .worklogs)
 * @param {{ limit?: number|null, offset?: number }} [opts] When `limit` is set (1–200), `items` is a page; `rollup` and `total_count` always reflect the full repo.
 * @returns {{ items: object[], rollup: object, total_count: number }}
 */
function collectWorkDashboard(cwd, opts = {}) {
  const root = path.resolve(cwd);
  const worklogs = path.join(root, '.worklogs');
  const items = [];

  if (!fs.existsSync(worklogs) || !fs.statSync(worklogs).isDirectory()) {
    return { items: [], rollup: buildRollup([]), total_count: 0 };
  }

  for (const id of fs.readdirSync(worklogs)) {
    if (id === '.' || id === '..') continue;
    const dir = path.join(worklogs, id);
    let st;
    try {
      st = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const statePath = path.join(dir, 'state.json');
    if (!fs.existsSync(statePath)) continue;
    let state;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      items.push({
        work_id: id,
        dir_id: id,
        error: 'invalid state.json',
      });
      continue;
    }

    const budget = state.budget || {};
    const pipeline = state.pipeline || {};
    const counters = state.counters || {};
    const hist = state.history;
    const historyLen = Array.isArray(hist) ? hist.length : 0;
    const createdMs = parseIsoMs(state.created_at);
    const updatedMs = parseIsoMs(state.updated_at);
    let durationMs = null;
    if (createdMs != null && updatedMs != null && updatedMs >= createdMs) {
      durationMs = updatedMs - createdMs;
    }

    const iterB = Number(budget.iteration_budget);
    const rem = Number(budget.budget_remaining);
    const iterationsUsed =
      Number.isFinite(iterB) && Number.isFinite(rem) ? Math.max(0, iterB - rem) : null;

    const costUsed = Number(budget.cost_used);
    const costCap = Number(budget.cost_budget_usd);
    const costRemaining =
      Number.isFinite(costUsed) && Number.isFinite(costCap) ? Number((costCap - costUsed).toFixed(6)) : null;

    const currentState = state.current_state != null ? String(state.current_state) : '';
    const isCompleted = currentState === 'completed';

    const usageTotals = budget.usage_totals && typeof budget.usage_totals === 'object' ? budget.usage_totals : null;
    const recentTransitions = recentTransitionsFromHistory(hist, 12);
    const state_histogram = stateHistogramFromHistory(hist);

    const stateJsonAbs = path.join(root, '.worklogs', id, 'state.json');

    items.push({
      work_id: state.work_id != null ? String(state.work_id) : id,
      dir_id: id,
      work_dir_relative: workDirRelative(id),
      state_json_abs_path: stateJsonAbs,
      task: state.task != null ? String(state.task) : '',
      current_state: currentState,
      track: pipeline.track != null ? String(pipeline.track) : null,
      created_at: state.created_at,
      updated_at: state.updated_at,
      duration_ms: durationMs,
      is_completed: isCompleted,
      iteration_budget: Number.isFinite(iterB) ? iterB : null,
      budget_remaining: Number.isFinite(rem) ? rem : null,
      iterations_used: iterationsUsed,
      cost_used_usd: Number.isFinite(costUsed) ? costUsed : null,
      cost_budget_usd: Number.isFinite(costCap) ? costCap : null,
      cost_remaining_usd: costRemaining,
      usage_totals: usageTotals,
      tokens_total: sumUsageTotals(usageTotals),
      counters: {
        subagent_spawns: counters.subagent_spawns,
        panel_runs: counters.panel_runs,
        design_iter: counters.design_iter,
        code_iter: counters.code_iter,
      },
      history_length: historyLen,
      recent_transitions: recentTransitions,
      state_histogram,
    });
  }

  items.sort((a, b) => {
    if (a.error && !b.error) return 1;
    if (!a.error && b.error) return -1;
    return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
  });

  const total_count = items.length;
  const rollup = buildRollup(items);
  const limitRaw = opts.limit;
  const offsetRaw = opts.offset != null ? opts.offset : 0;
  const offset = Math.max(0, Number(offsetRaw) || 0);
  let pageItems = items;
  if (limitRaw != null && limitRaw !== '') {
    const lim = Math.min(DASHBOARD_PAGE_LIMIT_MAX, Math.max(1, Number(limitRaw) || 1));
    pageItems = items.slice(offset, offset + lim);
  } else if (offset > 0) {
    pageItems = items.slice(offset);
  }

  return { items: pageItems, rollup, total_count };
}

function buildRollup(items) {
  const rollup = {
    work_item_count: 0,
    completed_count: 0,
    in_progress_count: 0,
    total_cost_used_usd: 0,
    total_cost_budget_usd: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cache_read_input_tokens: 0,
    total_cache_creation_input_tokens: 0,
    by_state: {},
  };

  for (const it of items) {
    if (it.error) continue;
    rollup.work_item_count += 1;
    if (it.is_completed) rollup.completed_count += 1;
    else rollup.in_progress_count += 1;

    const st = it.current_state || '(unknown)';
    rollup.by_state[st] = (rollup.by_state[st] || 0) + 1;

    if (typeof it.cost_used_usd === 'number' && Number.isFinite(it.cost_used_usd)) {
      rollup.total_cost_used_usd += it.cost_used_usd;
    }
    if (typeof it.cost_budget_usd === 'number' && Number.isFinite(it.cost_budget_usd)) {
      rollup.total_cost_budget_usd += it.cost_budget_usd;
    }

    const u = it.usage_totals;
    if (u && typeof u === 'object') {
      for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) {
        const key = `total_${k}`;
        const v = Number(u[k]);
        if (Number.isFinite(v)) rollup[key] = (rollup[key] || 0) + v;
      }
    }
  }

  rollup.total_cost_used_usd = Number(rollup.total_cost_used_usd.toFixed(6));
  rollup.total_cost_budget_usd = Number(rollup.total_cost_budget_usd.toFixed(6));
  return rollup;
}

module.exports = {
  collectWorkDashboard,
  buildRollup,
  sumUsageTotals,
  parseIsoMs,
  recentTransitionsFromHistory,
  stateHistogramFromHistory,
  workDirRelative,
};
