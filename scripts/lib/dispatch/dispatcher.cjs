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
  commitState,
  assertProjection,
  readJournal,
  projectedState,
  recoverState,
} = require('../shared/journal.cjs');
const { withWriteLockSync } = require('../shared/state-lock.cjs');
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
const HUMAN_GATE_STATES = new Set(['approval-wait', 'ambiguity-wait']);
const DEFAULT_MAX_PARALLEL = 1;
const DEFAULT_MAX_ATTEMPTS = 1;

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

function attemptWorkId(workId, attempt) {
  return attempt > 1 ? `${workId}.a${attempt}` : workId;
}

function goalEngineVersion(pluginRoot) {
  const root = path.resolve(pluginRoot || getDefaultPluginRoot());
  const packageJson = readJsonOrNull(path.join(root, 'package.json')) || {};
  const files = ['state-machine.json', 'goal-state-machine.json'];
  const digests = {};
  for (const file of files) {
    const full = path.join(root, file);
    digests[file] = fs.existsSync(full)
      ? crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
      : null;
  }
  return { version: packageJson.version || 'unknown', state_machine_digests: digests };
}

function maxParallel(goal) {
  const value = goal && goal.budget && goal.budget.max_parallel;
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_PARALLEL;
}

function maxAttempts(goal) {
  const value = goal && goal.budget && goal.budget.max_attempts;
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_ATTEMPTS;
}

function isGateState(state) {
  return HUMAN_GATE_STATES.has(state);
}

function writeGoalSnapshotLocked(goalDir, goal, meta, lease) {
  const loaded = loadGoal(goalDir);
  if (!loaded.ok) throw new Error(loaded.message);
  const chain = readJournal(goalDir);
  if (!chain.ok) {
    const err = new Error(`goal journal FAILED at seq ${chain.seq}`);
    err.code = 'INTEGRITY_FAILED';
    throw err;
  }
  const snapshot = commitState(
    goalDir,
    goal,
    { ...meta, expectCurrent: goal.current_state, expectedSeq: chain.events.length },
    { lease }
  );
  const goalPath = path.join(goalDir, 'goal.json');
  const tmp = `${goalPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, goalPath);
  return snapshot;
}

function mutateGoal(goalDir, actor, decision, mutate) {
  return withWriteLockSync(goalDir, (lock) => {
    const loaded = loadGoal(goalDir);
    if (!loaded.ok) return loaded;
    const goal = loaded.goal;
    goal.dispatch = goal.dispatch || {};
    goal.dispatch.decisions = Array.isArray(goal.dispatch.decisions) ? goal.dispatch.decisions : [];
    const at = new Date().toISOString();
    const entry = { at, actor, ...decision };
    if (decision.decision !== 'starting') goal.dispatch.decisions.push(entry);
    if (mutate) mutate(goal, entry);
    goal.updated_at = at;
    const eventType = decision.decision === 'starting'
      ? 'executor.starting'
      : `dispatch.${decision.decision}`;
    const snapshot = writeGoalSnapshotLocked(goalDir, goal, { type: eventType, at }, lock.lease);
    return { ok: true, snapshot, entry };
  });
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
  if (isGateState(cur)) return { status: 'gate', current_state: cur };
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

function latestChild(goal, itemId) {
  const children = (goal.children || []).filter((c) => c.item_id === itemId);
  return children.length ? children[children.length - 1] : null;
}

function nodeStatusesWithGoal(goalDir, plan, goal) {
  const root = workRootFor(goalDir);
  const out = new Map();
  for (const n of plan.nodes) {
    const child = latestChild(goal, n.id);
    const workId = child && child.attempt_work_id ? child.attempt_work_id : n.work_id;
    const live = childStatus(path.join(root, '.worklogs', workId));
    if (child && child.status === 'cancelled') out.set(n.id, { status: 'cancelled', current_state: live.current_state });
    else if (child && child.status === 'started' && live.status === 'pending') {
      out.set(n.id, { status: 'active', current_state: live.current_state });
    }
    else out.set(n.id, live);
  }
  for (const n of plan.nodes) {
    const s = out.get(n.id);
    if (s.status !== 'pending') continue;
    const waiting = n.depends_on.filter((d) => out.get(d).status !== 'completed');
    out.set(n.id, waiting.length ? { status: 'blocked', waiting_on: waiting } : { status: 'ready' });
  }
  return out;
}

function goalJournalStatuses(goal, plan) {
  const statuses = new Map();
  for (const n of plan.nodes) {
    const child = (goal.children || []).find((c) => c.item_id === n.id);
    if (child && child.status && child.status !== 'starting') {
      statuses.set(n.id, {
        status: child.status,
        current_state: child.current_state,
        work_id: child.attempt_work_id || child.work_id,
      });
    }
  }
  return statuses;
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
  const statuses = nodeStatusesWithGoal(goalDir, p, loaded.goal);
  const nodes = p.order.map((id) => {
    const n = p.nodes.find((x) => x.id === id);
    return { id, work_id: n.work_id, track: n.track, role: n.role, depends_on: n.depends_on, ...statuses.get(id) };
  });
  return { ok: true, goal_state: loaded.goal.current_state, nodes };
}

function initChild({ pluginRoot, workRoot, node, objective, engine }) {
  const workDir = path.join(workRoot, '.worklogs', node.work_id);
  if (fs.existsSync(path.join(workDir, 'state.json')) && fs.existsSync(path.join(workDir, 'journal.jsonl'))) {
    return { ok: true, workDir, reconciled: true };
  }
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
  if (engine) {
    const state = readJsonOrNull(path.join(workDir, 'state.json'));
    if (state) {
      state.executor = { ...(state.executor || {}), engine };
      state.pipeline = { ...(state.pipeline || {}), engine_version: engine.version, state_machine_digests: engine.state_machine_digests };
      const snapshot = commitState(workDir, state, { type: 'init', expectCurrent: state.current_state });
      fs.writeFileSync(path.join(workDir, 'state.json'), `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    }
  }
  return { ok: true, workDir };
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
  const actor = opts.actor;

  const loaded = loadForDispatch(goalDir);
  if (!loaded.ok) return loaded;
  const goal = loaded.goal;
  const p = goal.dispatch && goal.dispatch.plan;
  if (!p) return { ok: false, code: 'NO_PLAN', message: 'no dispatch plan; run `dispatch plan` first' };
  const restartApproval = goal.dispatch && goal.dispatch.restart_approvals
    && goal.dispatch.restart_approvals[opts.item || ''];
  if (goal.dispatch && goal.dispatch.cancelled_epoch && !(restartApproval && restartApproval.item_hash === (p.nodes.find((n) => n.id === opts.item) || {}).item_hash)) {
    return refuse(goalDir, goal, actor, 'CHILD_CANCELLED', 'dispatch was cancelled; a new user approval bound to the item hash is required', { item: opts.item || null });
  }
  if (!STARTABLE_GOAL_STATES.has(goal.current_state)) {
    return refuse(goalDir, goal, actor, 'GOAL_STATE', `children start only in goal-execute; goal is in ${goal.current_state}`, { item: opts.item || null });
  }

  // Reconcile a write-ahead start left behind by a crash. The child init is
  // idempotent at the work-id level, so this produces one child directory and
  // one dispatch.started event on the next invocation.
  const starting = (goal.children || []).find((c) => c.status === 'starting');
  if (starting) {
    const node = p.nodes.find((n) => n.id === starting.item_id);
    if (!node) return { ok: false, code: 'PLAN_INVALID', message: `starting item ${starting.item_id} is not in the plan` };
    const workId = starting.attempt_work_id || starting.work_id;
    const init = initChild({
      pluginRoot,
      workRoot: workRootFor(goalDir),
      node: { ...node, work_id: workId },
      objective: goal.objective,
      engine: goalEngineVersion(pluginRoot),
    });
    if (!init.ok) return refuse(goalDir, goal, actor, init.code, init.message, { item: node.id });
    const reconciled = mutateGoal(goalDir, actor, {
      decision: 'started',
      item: node.id,
      work_id: workId,
      attempt: starting.attempt || 1,
      reconciled: true,
      track: node.track,
      role: node.role,
      reviewers: node.reviewers,
    }, (current) => {
      const child = current.children.find((c) => c.item_id === node.id && c.attempt_work_id === workId);
      if (child) Object.assign(child, { status: 'started', started_at: child.started_at || new Date().toISOString() });
    });
    return { ok: true, item: node.id, work_id: workId, workDir: init.workDir, track: node.track, role: node.role, reviewers: node.reviewers, goal: reconciled.snapshot };
  }

  const statuses = nodeStatusesWithGoal(goalDir, p, goal);
  let id = opts.item;
  if (id) {
    if (!p.nodes.some((n) => n.id === id)) {
      return refuse(goalDir, goal, actor, 'DISPATCH_UNKNOWN_ITEM', `item ${id} is not in the dispatch plan`, { item: id });
    }
  } else {
    id = p.order.find((x) => statuses.get(x).status === 'ready');
    if (!id) {
      const open = p.order.filter((x) => ['active', 'interrupted', 'corrupt', 'starting'].includes(statuses.get(x).status));
      if (open.length) {
        return refuse(goalDir, goal, actor, 'DISPATCH_BUSY', `max_parallel ${maxParallel(goal)} has active children`, { item: null, open });
      }
      const done = p.order.every((x) => ['completed', 'failed', 'escalated', 'gate'].includes(statuses.get(x).status));
      return refuse(goalDir, goal, actor, done ? 'DISPATCH_DONE' : 'DISPATCH_NOTHING_READY',
        done ? 'every planned child is completed or terminal' : 'no planned child is ready', { item: null });
    }
  }
  const s = statuses.get(id);
  const open = p.order.filter((x) => ['active', 'interrupted', 'corrupt', 'starting'].includes(statuses.get(x).status));
  if (maxParallel(goal) === 1 && open.length) {
    return refuse(goalDir, goal, actor, 'DISPATCH_BUSY', `max_parallel ${maxParallel(goal)} has active children`, { item: id, open });
  }
  if (s.status === 'blocked') {
    return refuse(goalDir, goal, actor, 'DISPATCH_BLOCKED', `item ${id} waits on ${s.waiting_on.join(', ')} to reach completed`, { item: id, waiting_on: s.waiting_on });
  }
  if (open.length >= maxParallel(goal)) {
    return refuse(goalDir, goal, actor, 'DISPATCH_BUSY', `max_parallel ${maxParallel(goal)} reached`, { item: id, open });
  }
  if (s.status !== 'ready' && s.status !== 'cancelled') {
    return refuse(goalDir, goal, actor, 'DISPATCH_ALREADY_STARTED', `item ${id} child is already ${s.status}`, { item: id });
  }
  const budget = assertGoalBudget(goal);
  if (!budget.ok) return refuse(goalDir, goal, actor, budget.code, budget.message, { item: id });

  const node = p.nodes.find((n) => n.id === id);
  const prior = latestChild(goal, id);
  const restarting = s.status === 'cancelled';
  if (restarting && !(restartApproval && restartApproval.item_hash === node.item_hash)) {
    return refuse(goalDir, goal, actor, 'CHILD_CANCELLED', 'cancelled child requires a new user approval', { item: id });
  }
  const attempt = restarting ? Number(prior.attempt || 1) + 1 : 1;
  const workId = attemptWorkId(node.work_id, attempt);
  const engine = goalEngineVersion(pluginRoot);
  const effectiveNode = { ...node, work_id: workId };
  const writeAhead = mutateGoal(goalDir, actor, {
    decision: 'starting',
    item: id,
    work_id: workId,
    attempt,
    item_hash: node.item_hash,
    engine,
  }, (current) => {
    current.executor = { ...(current.executor || {}), engine };
    upsertChild(current, effectiveNode, {
      status: 'starting',
      attempt,
      attempt_work_id: workId,
      item_hash: node.item_hash,
      engine,
      started_at: new Date().toISOString(),
      cost_usd: Number(node.cost_usd || node.estimated_cost_usd || 0),
    });
    current.budget.cost_used = (current.budget.cost_used || 0) + Number(node.cost_usd || node.estimated_cost_usd || 0);
  });
  if (!writeAhead.ok) return writeAhead;

  const init = initChild({
    pluginRoot,
    workRoot: workRootFor(goalDir),
    node: { ...node, work_id: workId },
    objective: goal.objective,
    engine,
  });
  if (!init.ok) return { ok: false, code: init.code, message: init.message, item: id, starting: true };
  const started = mutateGoal(goalDir, actor, {
    decision: 'started',
    item: id,
    work_id: workId,
    attempt,
    item_hash: node.item_hash,
    track: node.track,
    role: node.role,
    reviewers: node.reviewers,
  }, (current) => {
    const child = current.children.find((c) => c.item_id === id && c.attempt_work_id === workId);
    if (child) child.status = 'started';
  });
  return {
    ok: true,
    item: id,
    work_id: workId,
    workDir: init.workDir,
    track: node.track,
    role: node.role,
    reviewers: node.reviewers,
    goal: started.snapshot,
  };
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
  if (s.status === 'completed' || s.status === 'failed' || s.status === 'escalated' || s.status === 'gate') {
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

function cancel(opts) {
  const goalDir = path.resolve(opts.goalDir);
  if (!opts.actor) return { ok: false, code: 'MISSING_ACTOR', message: 'dispatch cancel requires --actor' };
  const loaded = loadForDispatch(goalDir);
  if (!loaded.ok) return loaded;
  const p = loaded.goal.dispatch && loaded.goal.dispatch.plan;
  if (!p) return { ok: false, code: 'NO_PLAN', message: 'no dispatch plan; run `dispatch plan` first' };
  const result = mutateGoal(goalDir, opts.actor, {
    decision: 'cancelled',
    item: opts.item || null,
    reason: opts.reason || 'cooperative cancellation',
  }, (goal) => {
    goal.dispatch.cancelled_epoch = (goal.dispatch.cancelled_epoch || 0) + 1;
    goal.dispatch.cancelled_at = new Date().toISOString();
    for (const child of goal.children || []) {
      if (child.status === 'starting' || child.status === 'started') child.status = 'cancelled';
    }
  });
  return result.ok ? { ok: true, epoch: result.snapshot.dispatch.cancelled_epoch, goal: result.snapshot } : result;
}

function approveRestart(opts) {
  const goalDir = path.resolve(opts.goalDir);
  if (!opts.identity || typeof opts.identity.actor !== 'string' || !opts.identity.actor.startsWith('user:')) {
    return { ok: false, code: 'NO_IDENTITY', message: 'restart approval needs a user: identity' };
  }
  const loaded = loadForDispatch(goalDir);
  if (!loaded.ok) return loaded;
  const plan = loaded.goal.dispatch && loaded.goal.dispatch.plan;
  const node = plan && plan.nodes.find((n) => n.id === opts.item);
  if (!node) return { ok: false, code: 'DISPATCH_UNKNOWN_ITEM', message: `item ${opts.item} is not in the dispatch plan` };
  const result = mutateGoal(goalDir, opts.identity.actor, {
    decision: 'restart-approved',
    item: node.id,
    item_hash: node.item_hash,
  }, (goal, entry) => {
    goal.dispatch.restart_approvals = goal.dispatch.restart_approvals || {};
    goal.dispatch.restart_approvals[node.id] = {
      actor: entry.actor,
      at: entry.at,
      item_hash: node.item_hash,
    };
  });
  return result.ok ? { ok: true, item: node.id, goal: result.snapshot } : result;
}

function retryableFailure(state) {
  const code = state && (
    state.failure_code
    || (state.failure && state.failure.code)
    || (state.pipeline && state.pipeline.failure_code)
  );
  if (state && state.failure && state.failure.retryable === true) return true;
  if (state && state.pipeline && state.pipeline.retryable === true) return true;
  return new Set(['NETWORK_ERROR', 'TIMEOUT', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT']).has(code);
}

function retry(opts) {
  const goalDir = path.resolve(opts.goalDir);
  if (!opts.actor) return { ok: false, code: 'MISSING_ACTOR', message: 'dispatch retry requires --actor' };
  const loaded = loadForDispatch(goalDir);
  if (!loaded.ok) return loaded;
  const goal = loaded.goal;
  const p = goal.dispatch && goal.dispatch.plan;
  const node = p && p.nodes.find((n) => n.id === opts.item);
  if (!node) return { ok: false, code: 'DISPATCH_UNKNOWN_ITEM', message: `item ${opts.item} is not in the dispatch plan` };
  const current = latestChild(goal, node.id);
  if (!current) return { ok: false, code: 'DISPATCH_NOT_STARTED', message: `item ${node.id} has no failed attempt` };
  const currentDir = path.join(workRootFor(goalDir), '.worklogs', current.attempt_work_id || current.work_id);
  const state = readJsonOrNull(path.join(currentDir, 'state.json'));
  const live = childStatus(currentDir);
  if (live.status !== 'failed' || !state || state.current_state !== 'pipeline-failed') {
    return { ok: false, code: 'RETRY_NOT_ALLOWED', message: 'only pipeline-failed children can be retried' };
  }
  if (!retryableFailure(state)) return { ok: false, code: 'RETRY_NOT_ALLOWED', message: 'failure code is not classified retryable' };
  const attempt = Number(current.attempt || 1) + 1;
  if (attempt > maxAttempts(goal)) return { ok: false, code: 'MAX_ATTEMPTS', message: `max_attempts ${maxAttempts(goal)} reached` };
  const statuses = nodeStatusesWithGoal(goalDir, p, goal);
  const open = p.order.filter((id) => ['active', 'interrupted', 'corrupt', 'starting'].includes(statuses.get(id).status));
  if (open.length >= maxParallel(goal)) return { ok: false, code: 'DISPATCH_BUSY', message: `max_parallel ${maxParallel(goal)} reached` };
  const workId = attemptWorkId(node.work_id, attempt);
  const writeAhead = mutateGoal(goalDir, opts.actor, {
    decision: 'starting',
    item: node.id,
    work_id: workId,
    attempt,
    item_hash: node.item_hash,
    retry_of: current.attempt_work_id || current.work_id,
  }, (currentGoal) => {
    upsertChild(currentGoal, { ...node, work_id: workId }, {
      status: 'starting',
      attempt,
      attempt_work_id: workId,
      item_hash: node.item_hash,
      retry_of: current.attempt_work_id || current.work_id,
      not_before: new Date().toISOString(),
      cost_usd: Number(node.cost_usd || node.estimated_cost_usd || 0),
    });
    currentGoal.budget.cost_used = (currentGoal.budget.cost_used || 0) + Number(node.cost_usd || node.estimated_cost_usd || 0);
  });
  if (!writeAhead.ok) return writeAhead;
  const init = initChild({
    pluginRoot: opts.pluginRoot || getDefaultPluginRoot(),
    workRoot: workRootFor(goalDir),
    node: { ...node, work_id: workId },
    objective: goal.objective,
    engine: goalEngineVersion(opts.pluginRoot || getDefaultPluginRoot()),
  });
  if (!init.ok) return { ok: false, code: init.code, message: init.message, starting: true };
  const started = mutateGoal(goalDir, opts.actor, {
    decision: 'started',
    item: node.id,
    work_id: workId,
    attempt,
    retry_of: current.attempt_work_id || current.work_id,
  }, (currentGoal) => {
    const child = latestChild(currentGoal, node.id);
    if (child) child.status = 'started';
  });
  return started.ok ? { ok: true, item: node.id, work_id: workId, attempt, workDir: init.workDir, goal: started.snapshot } : started;
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
  cancel: guarded(cancel),
  retry: guarded(retry),
  approveRestart: guarded(approveRestart),
  enqueue: guarded(enqueue),
  approveItems: guarded(approveItems),
};
