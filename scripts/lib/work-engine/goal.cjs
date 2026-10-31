'use strict';

/**
 * Goal loop engine (outer). Structural twin of the per-work-item engine, one level up.
 * Validates transitions against goal-state-machine.json and applies them to goal.json.
 * Kept intentionally small (first slice): edges, shape validation, transition apply.
 */

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./engine.cjs');
const { assertProjection, commitState } = require('./journal.cjs');
const { withWriteLockSync } = require('./state-lock.cjs');

const GOAL_DECISION_TARGET = {
  approved: 'goal-met',
  changes_requested: 'goal-execute',
};
const GOAL_RECORD_FILE = 'approval-record.json';

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

function assertGoalBudget(goal) {
  const budget = (goal && goal.budget) || {};
  const used = (key) => (typeof budget[key] === 'number' ? budget[key] : 0);
  const cap = (key) => (typeof budget[key] === 'number' ? budget[key] : Infinity);
  const errors = [];
  if (used('loop_turns_used') >= cap('max_loop_turns')) errors.push('loop_turns_used >= max_loop_turns');
  if (used('child_items_used') >= cap('max_child_items')) errors.push('child_items_used >= max_child_items');
  if (used('cost_used') >= cap('cost_budget_usd')) errors.push('cost_used >= cost_budget_usd');
  if (!errors.length) return { ok: true };
  return { ok: false, code: 'GOAL_BUDGET_STOP', message: errors.join('; ') };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Leaving goal-approval requires an approval record written by `goal approve`.
 */
function assertGoalHumanApproval({ goalDir, from, to, goal, humanApproval }) {
  if (from !== 'goal-approval') return { ok: true };
  const deny = (why) => ({
    ok: false,
    code: 'HUMAN_APPROVAL_REQUIRED',
    message: `goal-approval → ${to} needs a human decision: ${why}. A human must run \`agentic-swe goal approve --goal-dir ${goalDir} --decision approved|changes_requested\` in their own terminal.`,
  });
  if (!humanApproval || !humanApproval.record) return deny('no approval record supplied');
  const rec = readJson(path.join(goalDir, path.basename(humanApproval.record)));
  if (!rec) return deny(`${humanApproval.record} missing or unreadable`);
  if (GOAL_DECISION_TARGET[rec.decision] !== to) return deny(`record decision "${rec.decision}" does not lead to ${to}`);
  const iter = (goal && goal.counters && goal.counters.approval_iter) || 0;
  if (rec.approval_iter !== iter) return deny(`record is from approval round ${rec.approval_iter}, current round is ${iter}`);
  if (typeof rec.actor !== 'string' || !rec.actor.startsWith('user:')) return deny('record actor is not a user identity');
  return { ok: true, record: rec };
}

/**
 * Fsync a journal event, then replace goal.json, under the work-dir write lock.
 * @param {string} goalDir
 * @param {object} goal
 * @param {{ type: string, at?: string, expectCurrent?: string }} meta
 * @param {{ maxAttempts?: number, baseDelayMs?: number }} [lockOpts]
 */
function commitGoal(goalDir, goal, meta, lockOpts) {
  return withWriteLockSync(goalDir, () => {
    const snapshot = commitState(goalDir, goal, meta);
    const goalPath = goalPathFor(goalDir);
    const tmp = `${goalPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, goalPath);
    return snapshot;
  }, lockOpts);
}

/**
 * Validate + apply an outer goal transition.
 * @param {{goalDir:string, pluginRoot?:string, to:string, from?:string, actor:string,
 *          reason?:string, evidence_refs?:string[], dryRun?:boolean,
 *          humanApproval?: { record: string }, lock?: object }} opts
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

  const projection = assertProjection(goalDir, goal, { stateFile: 'goal.json' });
  if (!projection.ok) return projection;

  const edge = assertGoalEdge(pluginRoot, from, to);
  if (!edge.ok) return edge;

  const budget = assertGoalBudget(goal);
  if (!budget.ok) return budget;

  const human = assertGoalHumanApproval({
    goalDir,
    from,
    to,
    goal,
    humanApproval: opts.humanApproval,
  });
  if (!human.ok) return human;

  const nowIso = new Date().toISOString();
  if (opts.dryRun) {
    return { ok: true, dryRun: true, from, to, nextState: { current_state: to } };
  }

  goal.current_state = to;
  goal.updated_at = nowIso;
  goal.budget = goal.budget || {};
  goal.budget.loop_turns_used = (goal.budget.loop_turns_used || 0) + 1;
  goal.history = Array.isArray(goal.history) ? goal.history : [];
  goal.history.push({
    at: nowIso,
    actor,
    from,
    to,
    reason: opts.reason || null,
    evidence_refs: Array.isArray(opts.evidence_refs) ? opts.evidence_refs : [],
  });

  try {
    const snapshot = commitGoal(
      goalDir,
      goal,
      { type: 'transition', at: nowIso, expectCurrent: from },
      opts.lock
    );
    fs.appendFileSync(
      path.join(goalDir, 'audit.log'),
      `${nowIso} actor=${actor} action=transition from=${from} to=${to}\n`,
      'utf8'
    );
    return { ok: true, goal: snapshot, from, to };
  } catch (e) {
    if (e && (e.code === 'LOCK_TIMEOUT' || e.code === 'INTEGRITY_FAILED')) {
      return { ok: false, code: e.code, message: String(e.message) };
    }
    return { ok: false, code: 'WRITE_ERROR', message: String(e.message) };
  }
}

module.exports = {
  GOAL_DECISION_TARGET,
  GOAL_RECORD_FILE,
  loadGoalEdges,
  assertGoalEdge,
  validateGoalShape,
  assertGoalBudget,
  assertGoalHumanApproval,
  loadGoal,
  commitGoal,
  applyGoalTransition,
  goalPathFor,
};
