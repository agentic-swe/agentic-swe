'use strict';

/**
 * Work dispatcher (AE-014). Turns approved items in goal.json `discovery.queue` into a
 * dependency DAG of child work items, routes each to a role + track, starts children only
 * once their predecessors are `completed`, and resumes an interrupted child from its journal.
 * Every decision is committed to the goal journal as a `dispatch.*` event.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDefaultPluginRoot } = require('../work-engine/engine.cjs');
const { loadGoal, commitGoal, assertGoalBudget } = require('../work-engine/goal.cjs');
const {
  canonical,
  assertProjection,
  readJournal,
  projectedState,
  recoverState,
} = require('../work-engine/journal.cjs');
const { resolvePolicyChecked, checkTrackRules } = require('../policy/merge.cjs');
const { loadRoles } = require('../policy/roles.cjs');

const TRACK_ORDER = { lean: 0, standard: 1, rigorous: 2 };
const DESIGN_PANEL = ['architecture-reviewer', 'security-reviewer', 'adversarial-reviewer'];

const WORK_TYPES = {
  docs: { track: 'lean', role: 'developer', reviewers: [] },
  test: { track: 'lean', role: 'developer', reviewers: [] },
  bugfix: { track: 'standard', role: 'developer', reviewers: [] },
  feature: { track: 'standard', role: 'developer', reviewers: [] },
  refactor: { track: 'standard', role: 'developer', reviewers: [] },
  policy: { track: 'rigorous', role: 'developer', reviewers: DESIGN_PANEL },
  security: { track: 'rigorous', role: 'developer', reviewers: DESIGN_PANEL },
};

const ITEM_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const GOAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PLANNABLE_GOAL_STATES = new Set(['goal-discovery', 'goal-execute']);
const STARTABLE_GOAL_STATES = new Set(['goal-execute']);
const ESCALATED = /^escalate-/;

function itemHash(item) {
  const { approval, ...content } = item || {};
  return crypto.createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');
}

function isApproved(item) {
  const a = item && item.approval;
  return Boolean(
    a && typeof a.actor === 'string' && a.actor.startsWith('user:') && a.item_hash === itemHash(item)
  );
}

function maxTrack(a, b) {
  if (!a) return b;
  if (!b) return a;
  return TRACK_ORDER[b] > TRACK_ORDER[a] ? b : a;
}

/**
 * Route one queue item to { track, role, reviewers }. Repo policy track_rules can only raise
 * the track a work type implies.
 */
function routeItem(item, { policy, roles } = {}) {
  const base = WORK_TYPES[item && item.type];
  if (!base) {
    return {
      ok: false,
      code: 'UNKNOWN_WORK_TYPE',
      message: `item ${item && item.id}: unknown type "${item && item.type}" (known: ${Object.keys(WORK_TYPES).join(', ')})`,
    };
  }
  const reasons = [`type ${item.type} → ${base.track}`];
  let track = base.track;
  const paths = Array.isArray(item.paths) ? item.paths : [];
  if (policy && paths.length) {
    const minimum = checkTrackRules(paths, policy);
    if (minimum && TRACK_ORDER[minimum] > TRACK_ORDER[track]) {
      reasons.push(`policy track_rules require ${minimum}`);
      track = maxTrack(track, minimum);
    }
  }
  const reviewers = track === 'rigorous' ? DESIGN_PANEL.slice() : base.reviewers.slice();
  if (roles) {
    for (const id of [base.role, ...reviewers]) {
      if (!roles.has(id)) {
        return { ok: false, code: 'ROLE_UNKNOWN', message: `item ${item.id}: role ${id} is not defined in config/roles` };
      }
    }
  }
  return { ok: true, track, role: base.role, reviewers, reasons };
}

function validateItem(item, seen) {
  const errors = [];
  if (!item || typeof item !== 'object') return ['queue entry is not an object'];
  if (typeof item.id !== 'string' || !ITEM_ID.test(item.id)) errors.push(`item id "${item.id}" must match ${ITEM_ID}`);
  else if (seen.has(item.id)) errors.push(`duplicate item id ${item.id}`);
  if (typeof item.title !== 'string' || !item.title.trim()) errors.push(`item ${item.id}: title is required`);
  if (item.depends_on != null && !Array.isArray(item.depends_on)) errors.push(`item ${item.id}: depends_on must be an array`);
  if (item.paths != null && !Array.isArray(item.paths)) errors.push(`item ${item.id}: paths must be an array`);
  return errors;
}

function childWorkId(goalId, itemId) {
  return `${goalId}--${itemId}`;
}

/**
 * Pure planner: approved queue items → topologically ordered nodes.
 * @param {{ goal: object, policy?: object, roles?: Map<string, object> }} input
 */
function planDispatch({ goal, policy, roles }) {
  const errors = [];
  if (!PLANNABLE_GOAL_STATES.has(goal.current_state)) {
    return {
      ok: false,
      code: 'GOAL_STATE',
      errors: [`dispatch plan needs the goal in ${[...PLANNABLE_GOAL_STATES].join(' or ')}; it is in ${goal.current_state}`],
    };
  }
  if (typeof goal.goal_id !== 'string' || !GOAL_ID.test(goal.goal_id) || goal.goal_id.includes('..')) {
    return { ok: false, code: 'GOAL_ID_INVALID', errors: [`goal_id "${goal.goal_id}" cannot name child work dirs`] };
  }
  const queue = (goal.discovery && Array.isArray(goal.discovery.queue)) ? goal.discovery.queue : [];
  const seen = new Set();
  for (const item of queue) {
    errors.push(...validateItem(item, seen));
    if (item && typeof item.id === 'string') seen.add(item.id);
  }
  if (errors.length) return { ok: false, code: 'QUEUE_INVALID', errors };

  const approved = queue.filter(isApproved);
  const skipped = queue
    .filter((i) => !isApproved(i))
    .map((i) => ({ id: i.id, reason: i.approval ? 'approval does not match item content' : 'not approved' }));
  const approvedIds = new Set(approved.map((i) => i.id));
  const byId = new Map(queue.map((i) => [i.id, i]));

  const nodes = [];
  for (const item of approved) {
    const deps = item.depends_on || [];
    for (const dep of deps) {
      if (!byId.has(dep)) errors.push(`item ${item.id}: depends on unknown item ${dep}`);
      else if (!approvedIds.has(dep)) errors.push(`item ${item.id}: depends on unapproved item ${dep}`);
      if (dep === item.id) errors.push(`item ${item.id}: depends on itself`);
    }
    const route = routeItem(item, { policy, roles });
    if (!route.ok) {
      errors.push(route.message);
      continue;
    }
    nodes.push({
      id: item.id,
      title: item.title,
      type: item.type,
      work_id: childWorkId(goal.goal_id, item.id),
      track: route.track,
      role: route.role,
      reviewers: route.reviewers,
      route_reasons: route.reasons,
      depends_on: deps.slice(),
      paths: Array.isArray(item.paths) ? item.paths.slice() : [],
      item_hash: itemHash(item),
    });
  }
  if (errors.length) return { ok: false, code: 'PLAN_INVALID', errors };

  const order = [];
  const remaining = new Map(nodes.map((n) => [n.id, new Set(n.depends_on)]));
  while (remaining.size) {
    const ready = nodes.filter((n) => remaining.has(n.id) && remaining.get(n.id).size === 0);
    if (!ready.length) {
      return { ok: false, code: 'DAG_CYCLE', errors: [`dependency cycle among: ${[...remaining.keys()].join(', ')}`] };
    }
    for (const n of ready) {
      order.push(n.id);
      remaining.delete(n.id);
      for (const deps of remaining.values()) deps.delete(n.id);
    }
  }
  return { ok: true, nodes, order, skipped };
}

function workRootFor(goalDir) {
  return path.resolve(goalDir, '..', '..', '..');
}

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Child status from its work dir: pending (not created), completed, failed, escalated,
 * active, or interrupted (state.json unreadable or behind its journal).
 */
function childStatus(workDir) {
  if (!fs.existsSync(workDir)) return { status: 'pending' };
  const chain = readJournal(workDir);
  if (!chain.ok) return { status: 'corrupt', message: `journal FAILED at seq ${chain.seq}` };
  const projected = projectedState(chain);
  if (!projected) return { status: 'interrupted', reason: 'journal is empty' };
  const state = readJsonOrNull(path.join(workDir, 'state.json'));
  const lastSeq = chain.events[chain.events.length - 1].seq;
  if (!state) return { status: 'interrupted', reason: 'state.json missing or unreadable', current_state: projected.current_state };
  const proj = assertProjection(workDir, state);
  const seq = state.journal && state.journal.seq;
  if (!proj.ok || seq !== lastSeq) {
    return { status: 'interrupted', reason: proj.ok ? `state.json at seq ${seq}, journal at ${lastSeq}` : proj.message, current_state: projected.current_state };
  }
  const cur = state.current_state;
  if (cur === 'completed') return { status: 'completed', current_state: cur };
  if (cur === 'pipeline-failed') return { status: 'failed', current_state: cur };
  if (ESCALATED.test(cur)) return { status: 'escalated', current_state: cur };
  return { status: 'active', current_state: cur };
}

function nodeStatuses(goalDir, plan) {
  const root = workRootFor(goalDir);
  const out = new Map();
  for (const n of plan.nodes) out.set(n.id, childStatus(path.join(root, '.worklogs', n.work_id)));
  for (const n of plan.nodes) {
    const s = out.get(n.id);
    if (s.status !== 'pending') continue;
    const waiting = n.depends_on.filter((d) => out.get(d).status !== 'completed');
    out.set(n.id, waiting.length ? { status: 'blocked', waiting_on: waiting } : { status: 'ready' });
  }
  return out;
}

function appendAudit(goalDir, line) {
  fs.appendFileSync(path.join(goalDir, 'audit.log'), `${line}\n`, 'utf8');
}

function recordDecision(goalDir, goal, decision, actor) {
  const nowIso = new Date().toISOString();
  goal.dispatch = goal.dispatch || {};
  goal.dispatch.decisions = Array.isArray(goal.dispatch.decisions) ? goal.dispatch.decisions : [];
  const entry = { at: nowIso, actor, ...decision };
  goal.dispatch.decisions.push(entry);
  goal.updated_at = nowIso;
  const snapshot = commitGoal(goalDir, goal, {
    type: `dispatch.${decision.decision}`,
    at: nowIso,
    expectCurrent: goal.current_state,
  });
  const fields = [`${nowIso} actor=${actor} action=dispatch_${decision.decision}`];
  if (decision.item) fields.push(`item=${decision.item}`);
  if (decision.work_id) fields.push(`work_id=${decision.work_id}`);
  if (decision.code) fields.push(`code=${decision.code}`);
  appendAudit(goalDir, fields.join(' '));
  return { snapshot, entry };
}

function loadForDispatch(goalDir) {
  const loaded = loadGoal(goalDir);
  if (!loaded.ok) return loaded;
  const projection = assertProjection(goalDir, loaded.goal, { stateFile: 'goal.json' });
  if (!projection.ok) return projection;
  return { ok: true, goal: loaded.goal };
}

function loadContext(goalDir, pluginRoot) {
  const resolved = resolvePolicyChecked(workRootFor(goalDir), pluginRoot);
  if (resolved.errors.length) {
    return { ok: false, code: 'POLICY_INVALID', message: resolved.errors.join('; ') };
  }
  const rolesDir = process.env.AGENTIC_SWE_ROLES_DIR || path.join(pluginRoot, 'config', 'roles');
  const { roles, errors } = loadRoles(rolesDir);
  if (errors.length) return { ok: false, code: 'ROLES_INVALID', message: errors.join('; ') };
  return { ok: true, policy: resolved.policy, roles };
}

/**
 * `dispatch plan`. Dry-run computes the plan and writes nothing.
 * @param {{ goalDir: string, pluginRoot?: string, actor?: string, dryRun?: boolean }} opts
 */
function plan(opts) {
  const goalDir = path.resolve(opts.goalDir);
  const pluginRoot = opts.pluginRoot || getDefaultPluginRoot();
  const loaded = loadForDispatch(goalDir);
  if (!loaded.ok) return loaded;
  const ctx = loadContext(goalDir, pluginRoot);
  if (!ctx.ok) return ctx;
  const goal = loaded.goal;
  const result = planDispatch({ goal, policy: ctx.policy, roles: ctx.roles });
  if (!result.ok) return { ok: false, code: result.code, message: result.errors.join('; '), errors: result.errors };

  const started = (goal.children || []).filter((c) => c.item_id);
  const planned = new Set(result.nodes.map((n) => n.id));
  const dropped = started.filter((c) => !planned.has(c.item_id)).map((c) => c.item_id);
  if (dropped.length) {
    return { ok: false, code: 'PLAN_DROPS_STARTED', message: `new plan drops already-started items: ${dropped.join(', ')}` };
  }
  if (opts.dryRun) return { ok: true, dryRun: true, ...result };

  if (!opts.actor) return { ok: false, code: 'MISSING_ACTOR', message: 'dispatch plan requires --actor (or --dry-run)' };
  goal.dispatch = goal.dispatch || {};
  goal.dispatch.plan = {
    planned_at: new Date().toISOString(),
    nodes: result.nodes,
    order: result.order,
    skipped: result.skipped,
  };
  const { snapshot } = recordDecision(goalDir, goal, {
    decision: 'planned',
    order: result.order,
    skipped: result.skipped.map((s) => s.id),
  }, opts.actor);
  return { ok: true, dryRun: false, ...result, goal: snapshot };
}

function status(opts) {
  const goalDir = path.resolve(opts.goalDir);
  const loaded = loadForDispatch(goalDir);
  if (!loaded.ok) return loaded;
  const p = loaded.goal.dispatch && loaded.goal.dispatch.plan;
  if (!p) return { ok: false, code: 'NO_PLAN', message: 'no dispatch plan; run `dispatch plan` first' };
  const statuses = nodeStatuses(goalDir, p);
  const nodes = p.order.map((id) => {
    const n = p.nodes.find((x) => x.id === id);
    return { id, work_id: n.work_id, track: n.track, role: n.role, depends_on: n.depends_on, ...statuses.get(id) };
  });
  return { ok: true, goal_state: loaded.goal.current_state, nodes };
}

function initChild({ pluginRoot, workRoot, node, objective }) {
  const script = path.join(pluginRoot, 'scripts', 'work-engine.cjs');
  const task = `${node.title} (goal: ${objective || 'n/a'}; dispatched item ${node.id})`;
  const res = spawnSync(
    process.execPath,
    [script, 'init', '--id', node.work_id, '--task', task, '--work-root', workRoot,
      '--budget-profile', node.track, '--plugin-root', pluginRoot, '--json'],
    { encoding: 'utf8', env: process.env }
  );
  if (res.status !== 0) {
    return { ok: false, code: 'CHILD_INIT_FAILED', message: (res.stderr || res.stdout || '').trim() || `exit ${res.status}` };
  }
  return { ok: true, workDir: path.join(workRoot, '.worklogs', node.work_id) };
}

function refuse(goalDir, goal, actor, code, message, extra = {}) {
  recordDecision(goalDir, goal, { decision: 'refused', code, message, ...extra }, actor);
  return { ok: false, code, message, ...extra };
}

function upsertChild(goal, node, fields) {
  goal.children = Array.isArray(goal.children) ? goal.children : [];
  let child = goal.children.find((c) => c.work_id === node.work_id);
  const isNew = !child;
  if (isNew) {
    child = { work_id: node.work_id, item_id: node.id, status: 'started', contribution: null, track: node.track, role: node.role };
    goal.children.push(child);
    goal.budget = goal.budget || {};
    goal.budget.child_items_used = (goal.budget.child_items_used || 0) + 1;
  }
  Object.assign(child, fields);
  return isNew;
}

/**
 * `dispatch start`: create the next ready child (or `--item`). Refuses — and journals the
 * refusal — when a predecessor is not completed, another child is still open, or the goal
 * budget is spent.
 */
function start(opts) {
  const goalDir = path.resolve(opts.goalDir);
  const pluginRoot = opts.pluginRoot || getDefaultPluginRoot();
  if (!opts.actor) return { ok: false, code: 'MISSING_ACTOR', message: 'dispatch start requires --actor' };
  const loaded = loadForDispatch(goalDir);
  if (!loaded.ok) return loaded;
  const goal = loaded.goal;
  const p = goal.dispatch && goal.dispatch.plan;
  if (!p) return { ok: false, code: 'NO_PLAN', message: 'no dispatch plan; run `dispatch plan` first' };
  const actor = opts.actor;

  if (!STARTABLE_GOAL_STATES.has(goal.current_state)) {
    return refuse(goalDir, goal, actor, 'GOAL_STATE', `children start only in goal-execute; goal is in ${goal.current_state}`, { item: opts.item || null });
  }
  const statuses = nodeStatuses(goalDir, p);
  const open = p.order.filter((id) => ['active', 'interrupted', 'corrupt'].includes(statuses.get(id).status));
  if (open.length) {
    return refuse(goalDir, goal, actor, 'DISPATCH_BUSY', `child ${open[0]} is still ${statuses.get(open[0]).status}; one active child at a time`, { item: opts.item || null, open });
  }
  let id = opts.item;
  if (id) {
    if (!p.nodes.some((n) => n.id === id)) {
      return refuse(goalDir, goal, actor, 'DISPATCH_UNKNOWN_ITEM', `item ${id} is not in the dispatch plan`, { item: id });
    }
  } else {
    id = p.order.find((x) => statuses.get(x).status === 'ready');
    if (!id) {
      const done = p.order.every((x) => statuses.get(x).status === 'completed');
      return refuse(goalDir, goal, actor, done ? 'DISPATCH_DONE' : 'DISPATCH_NOTHING_READY',
        done ? 'every planned child is completed' : 'no planned child is ready', { item: null });
    }
  }
  const s = statuses.get(id);
  if (s.status === 'blocked') {
    return refuse(goalDir, goal, actor, 'DISPATCH_BLOCKED', `item ${id} waits on ${s.waiting_on.join(', ')} to reach completed`, { item: id, waiting_on: s.waiting_on });
  }
  if (s.status !== 'ready') {
    return refuse(goalDir, goal, actor, 'DISPATCH_ALREADY_STARTED', `item ${id} child is already ${s.status}`, { item: id });
  }
  const budget = assertGoalBudget(goal);
  if (!budget.ok) return refuse(goalDir, goal, actor, budget.code, budget.message, { item: id });

  const node = p.nodes.find((n) => n.id === id);
  const init = initChild({ pluginRoot, workRoot: workRootFor(goalDir), node, objective: goal.objective });
  if (!init.ok) return refuse(goalDir, goal, actor, init.code, init.message, { item: id });
  upsertChild(goal, node, { status: 'started', started_at: new Date().toISOString() });
  const { snapshot } = recordDecision(goalDir, goal, {
    decision: 'started',
    item: id,
    work_id: node.work_id,
    track: node.track,
    role: node.role,
    reviewers: node.reviewers,
  }, actor);
  return { ok: true, item: id, work_id: node.work_id, workDir: init.workDir, track: node.track, role: node.role, reviewers: node.reviewers, goal: snapshot };
}

/**
 * `dispatch resume`: rebuild an interrupted child's state.json from its journal and hand it
 * back at its projected state. Completed predecessors are never touched.
 */
function resume(opts) {
  const goalDir = path.resolve(opts.goalDir);
  if (!opts.actor) return { ok: false, code: 'MISSING_ACTOR', message: 'dispatch resume requires --actor' };
  if (!opts.item) return { ok: false, code: 'MISSING_ITEM', message: 'dispatch resume requires --item' };
  const loaded = loadForDispatch(goalDir);
  if (!loaded.ok) return loaded;
  const goal = loaded.goal;
  const p = goal.dispatch && goal.dispatch.plan;
  if (!p) return { ok: false, code: 'NO_PLAN', message: 'no dispatch plan; run `dispatch plan` first' };
  const actor = opts.actor;
  const node = p.nodes.find((n) => n.id === opts.item);
  if (!node) return refuse(goalDir, goal, actor, 'DISPATCH_UNKNOWN_ITEM', `item ${opts.item} is not in the dispatch plan`, { item: opts.item });

  const workDir = path.join(workRootFor(goalDir), '.worklogs', node.work_id);
  const s = childStatus(workDir);
  if (s.status === 'pending') {
    return refuse(goalDir, goal, actor, 'DISPATCH_NOT_STARTED', `item ${node.id} has no child yet; use dispatch start`, { item: node.id });
  }
  if (s.status === 'corrupt') {
    return refuse(goalDir, goal, actor, 'INTEGRITY_FAILED', `child ${node.work_id}: ${s.message}`, { item: node.id });
  }
  if (s.status === 'completed' || s.status === 'failed' || s.status === 'escalated') {
    return refuse(goalDir, goal, actor, 'DISPATCH_NOTHING_TO_RESUME',
      `child ${node.work_id} is ${s.status} (${s.current_state}); ${s.status === 'completed' ? 'nothing to resume' : 'a human decides the next step'}`,
      { item: node.id });
  }

  let recovered = false;
  let current = s.current_state;
  if (s.status === 'interrupted') {
    const r = recoverState(workDir);
    if (!r.ok) return refuse(goalDir, goal, actor, r.code, r.message, { item: node.id });
    recovered = true;
    current = r.state.current_state;
  }
  upsertChild(goal, node, { status: 'started', resumed_at: new Date().toISOString() });
  const { snapshot } = recordDecision(goalDir, goal, {
    decision: 'resumed',
    item: node.id,
    work_id: node.work_id,
    recovered,
    child_state: current,
    reason: s.reason || null,
  }, actor);
  return { ok: true, item: node.id, work_id: node.work_id, workDir, recovered, current_state: current, goal: snapshot };
}

/**
 * Append an item to discovery.queue. Items are immutable once queued so an approval
 * (bound to the item hash) cannot be carried over to different content.
 */
function enqueue(opts) {
  const goalDir = path.resolve(opts.goalDir);
  if (!opts.actor) return { ok: false, code: 'MISSING_ACTOR', message: 'dispatch enqueue requires --actor' };
  const loaded = loadForDispatch(goalDir);
  if (!loaded.ok) return loaded;
  const goal = loaded.goal;
  const item = {
    id: opts.id,
    title: opts.title,
    type: opts.type,
    depends_on: opts.dependsOn || [],
    paths: opts.paths || [],
  };
  if (opts.task) item.task = opts.task;
  goal.discovery = goal.discovery || {};
  goal.discovery.queue = Array.isArray(goal.discovery.queue) ? goal.discovery.queue : [];
  const errors = validateItem(item, new Set(goal.discovery.queue.map((i) => i && i.id)));
  if (!WORK_TYPES[item.type]) errors.push(`item ${item.id}: unknown type "${item.type}" (known: ${Object.keys(WORK_TYPES).join(', ')})`);
  if (errors.length) return { ok: false, code: 'QUEUE_INVALID', message: errors.join('; '), errors };
  goal.discovery.queue.push(item);
  const { snapshot } = recordDecision(goalDir, goal, { decision: 'enqueued', item: item.id, type: item.type }, opts.actor);
  return { ok: true, item, goal: snapshot };
}

/**
 * Record a human approval on queue items. Callers verify a human context first.
 * @param {{ goalDir: string, items: string[], identity: { actor: string }, note?: string }} opts
 */
function approveItems({ goalDir, items, identity, note }) {
  goalDir = path.resolve(goalDir);
  if (!identity || typeof identity.actor !== 'string' || !identity.actor.startsWith('user:')) {
    return { ok: false, code: 'NO_IDENTITY', message: 'approval needs a user: identity' };
  }
  const loaded = loadForDispatch(goalDir);
  if (!loaded.ok) return loaded;
  const goal = loaded.goal;
  const queue = (goal.discovery && Array.isArray(goal.discovery.queue)) ? goal.discovery.queue : [];
  const missing = items.filter((id) => !queue.some((i) => i && i.id === id));
  if (missing.length) return { ok: false, code: 'DISPATCH_UNKNOWN_ITEM', message: `not in discovery.queue: ${missing.join(', ')}` };
  const at = new Date().toISOString();
  for (const id of items) {
    const item = queue.find((i) => i.id === id);
    item.approval = { actor: identity.actor, at, note: note || null, item_hash: itemHash(item) };
  }
  const { snapshot } = recordDecision(goalDir, goal, { decision: 'approved', items }, identity.actor);
  return { ok: true, items, goal: snapshot };
}

/** Journal lock and integrity failures surface as results, like applyGoalTransition. */
function guarded(fn) {
  return (opts) => {
    try {
      return fn(opts);
    } catch (e) {
      if (e && (e.code === 'LOCK_TIMEOUT' || e.code === 'INTEGRITY_FAILED')) {
        return { ok: false, code: e.code, message: String(e.message) };
      }
      return { ok: false, code: 'WRITE_ERROR', message: String(e && e.message ? e.message : e) };
    }
  };
}

module.exports = {
  WORK_TYPES,
  DESIGN_PANEL,
  itemHash,
  isApproved,
  routeItem,
  planDispatch,
  childWorkId,
  childStatus,
  plan: guarded(plan),
  status: guarded(status),
  start: guarded(start),
  resume: guarded(resume),
  enqueue: guarded(enqueue),
  approveItems: guarded(approveItems),
};
