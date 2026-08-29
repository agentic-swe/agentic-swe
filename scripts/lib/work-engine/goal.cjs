'use strict';

/**
 * Goal loop engine (outer). Structural twin of the per-work-item engine, one level up.
 * Validates transitions against goal-state-machine.json and applies them to goal.json.
 * Kept intentionally small (first slice): edges, shape validation, transition apply.
 */

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./engine.cjs');

/** @type {Map<string, {edges: Set<string>, terminal: Set<string>, gates: Set<string>}>} */
const cache = new Map();

function loadGoalEdges(pluginRoot) {
  const resolved = path.resolve(pluginRoot || getDefaultPluginRoot());
  if (cache.has(resolved)) return cache.get(resolved);
  const p = path.join(resolved, 'goal-state-machine.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const edges = new Set();
  for (const pair of raw.edges || []) {
    if (Array.isArray(pair) && pair.length === 2) edges.add(`${pair[0]}\0${pair[1]}`);
  }
  const out = {
    edges,
    terminal: new Set(raw.terminal_states || []),
    gates: new Set(raw.gate_states || []),
  };
  cache.set(resolved, out);
  return out;
}

/** @returns {{ok: boolean, code?: string, message?: string}} */
function assertGoalEdge(pluginRoot, from, to) {
  const { edges } = loadGoalEdges(pluginRoot);
  if (!edges.has(`${from}\0${to}`)) {
    return {
      ok: false,
      code: 'GOAL_EDGE_NOT_IN_GRAPH',
      message: `goal transition ${from} -> ${to} is not in goal-state-machine.json`,
    };
  }
  return { ok: true };
}

const REQUIRED_FIELDS = [
  'schema_version',
  'goal_id',
  'objective',
  'current_state',
  'completion_criteria',
  'budget',
  'history',
];

function validateGoalShape(goal) {
  const errors = [];
  if (!goal || typeof goal !== 'object') return { ok: false, errors: ['goal.json is not an object'] };
  for (const f of REQUIRED_FIELDS) {
    if (!(f in goal)) errors.push(`missing field: ${f}`);
  }
  if (goal.budget && typeof goal.budget === 'object') {
    for (const b of ['max_child_items', 'max_loop_turns', 'cost_budget_usd']) {
      if (!(b in goal.budget)) errors.push(`missing budget.${b}`);
    }
  }
  if (goal.history && !Array.isArray(goal.history)) errors.push('history must be an array');
  return { ok: errors.length === 0, errors };
}

function goalPathFor(goalDir) {
  return path.join(path.resolve(goalDir), 'goal.json');
}

function loadGoal(goalDir) {
  const goalPath = goalPathFor(goalDir);
  if (!fs.existsSync(goalPath)) {
    return { ok: false, code: 'GOAL_NOT_FOUND', message: `goal.json not found in ${goalDir}`, goalPath };
  }
  let goal;
  try {
    goal = JSON.parse(fs.readFileSync(goalPath, 'utf8'));
  } catch (e) {
    return { ok: false, code: 'GOAL_PARSE_ERROR', message: `goal.json invalid JSON: ${e.message}`, goalPath };
  }
  const shape = validateGoalShape(goal);
  if (!shape.ok) {
    return { ok: false, code: 'GOAL_SHAPE_INVALID', message: shape.errors.join('; '), goalPath, goal };
  }
  return { ok: true, goal, goalPath };
}

function writeGoalAtomic(goalPath, goal) {
  const tmp = `${goalPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(goal, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, goalPath);
}

/**
 * Validate + apply an outer goal transition.
 * @param {{goalDir:string, pluginRoot?:string, to:string, from?:string, actor:string,
 *          reason?:string, evidence_refs?:string[], dryRun?:boolean}} opts
 */
function applyGoalTransition(opts) {
  const { goalDir, to, actor } = opts;
  const pluginRoot = opts.pluginRoot || getDefaultPluginRoot();
  if (!to) return { ok: false, code: 'MISSING_TO', message: 'transition requires --to' };
  if (!actor) return { ok: false, code: 'MISSING_ACTOR', message: 'transition requires --actor' };

  const loaded = loadGoal(goalDir);
  if (!loaded.ok) return loaded;
  const goal = loaded.goal;
  const from = opts.from || goal.current_state;

  const edge = assertGoalEdge(pluginRoot, from, to);
  if (!edge.ok) return edge;

  const nowIso = new Date().toISOString();
  const entry = {
    at: nowIso,
    actor,
    from,
    to,
    reason: opts.reason || null,
    evidence_refs: Array.isArray(opts.evidence_refs) ? opts.evidence_refs : [],
  };

  if (opts.dryRun) {
    return { ok: true, dryRun: true, from, to, nextState: { current_state: to } };
  }

  goal.current_state = to;
  goal.updated_at = nowIso;
  goal.budget = goal.budget || {};
  goal.budget.loop_turns_used = (goal.budget.loop_turns_used || 0) + 1;
  goal.history = Array.isArray(goal.history) ? goal.history : [];
  goal.history.push(entry);
  writeGoalAtomic(loaded.goalPath, goal);
  return { ok: true, goal, from, to };
}

module.exports = {
  loadGoalEdges,
  assertGoalEdge,
  validateGoalShape,
  loadGoal,
  applyGoalTransition,
  goalPathFor,
};
