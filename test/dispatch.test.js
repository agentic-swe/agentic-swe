'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dispatcher = require('../scripts/lib/dispatch/dispatcher.cjs');
const { applyGoalTransition } = require('../scripts/lib/work-engine/goal.cjs');
const { commitState, readJournal } = require('../scripts/lib/work-engine/journal.cjs');
const { loadRoles } = require('../scripts/lib/policy/roles.cjs');

const root = path.join(__dirname, '..');
const FOUNDER = { actor: 'user:founder@example.com' };
const cleanEnv = { ...process.env };
delete cleanEnv.AGENTIC_SWE_POLICY;
delete cleanEnv.AGENTIC_SWE_ROLES_DIR;

function makeProject({ policy } = {}) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-test-'));
  if (policy) {
    fs.mkdirSync(path.join(project, '.agentic-swe'), { recursive: true });
    fs.writeFileSync(path.join(project, '.agentic-swe', 'policy.json'), JSON.stringify(policy));
  }
  const r = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'goal-engine.cjs'), 'init', '--id', 'g1', '--objective', 'ship m1',
    '--work-root', project, '--plugin-root', root, '--json',
  ], { encoding: 'utf8', env: cleanEnv });
  assert.strictEqual(r.status, 0, r.stderr);
  const goalDir = path.join(project, '.worklogs', 'goals', 'g1');
  goTo(goalDir, 'goal-discovery');
  return { project, goalDir };
}

function goTo(goalDir, to) {
  const r = applyGoalTransition({ goalDir, pluginRoot: root, to, actor: 'hypervisor' });
  assert.strictEqual(r.ok, true, r.message);
}

function enqueue(goalDir, id, type, extra = {}) {
  const r = dispatcher.enqueue({ goalDir, actor: 'hypervisor', id, type, title: `${type} ${id}`, ...extra });
  assert.strictEqual(r.ok, true, r.message);
}

function readGoal(goalDir) {
  return JSON.parse(fs.readFileSync(path.join(goalDir, 'goal.json'), 'utf8'));
}

function journalTypes(dir) {
  return readJournal(dir).events.map((e) => e.type);
}

function hashFile(file) {
  return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
}

function hashDir(dir) {
  return Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, hashFile(path.join(dir, f))]));
}

function childDir(project, itemId) {
  return path.join(project, '.worklogs', dispatcher.childWorkId('g1', itemId));
}

/** Commit a child state change to its journal; `writeState: false` simulates a crash before state.json. */
function advanceChild(workDir, to, { writeState = true } = {}) {
  const state = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
  const from = state.current_state;
  state.current_state = to;
  state.history = state.history || [];
  state.history.push({ at: new Date().toISOString(), actor: 'hypervisor', from, to });
  const snapshot = commitState(workDir, state, { type: 'transition', expectCurrent: from });
  if (writeState) fs.writeFileSync(path.join(workDir, 'state.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

/** Two-item chain: docs-a, then feature-b after docs-a; both approved and planned; goal in goal-execute. */
function plannedChain() {
  const ctx = makeProject();
  enqueue(ctx.goalDir, 'docs-a', 'docs');
  enqueue(ctx.goalDir, 'feature-b', 'feature', { dependsOn: ['docs-a'] });
  assert.strictEqual(dispatcher.approveItems({ goalDir: ctx.goalDir, items: ['docs-a', 'feature-b'], identity: FOUNDER }).ok, true);
  const p = dispatcher.plan({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
  assert.strictEqual(p.ok, true, p.message);
  goTo(ctx.goalDir, 'goal-execute');
  return ctx;
}

describe('dispatch routing', () => {
  const { roles } = loadRoles(path.join(root, 'config', 'roles'));

  it('routes docs, feature, and policy/security work to distinct role + track combinations', () => {
    const docs = dispatcher.routeItem({ id: 'a', type: 'docs' }, { roles });
    const feature = dispatcher.routeItem({ id: 'b', type: 'feature' }, { roles });
    const policy = dispatcher.routeItem({ id: 'c', type: 'policy' }, { roles });
    const security = dispatcher.routeItem({ id: 'd', type: 'security' }, { roles });
    assert.deepStrictEqual([docs.track, docs.role, docs.reviewers], ['lean', 'developer', []]);
    assert.deepStrictEqual([feature.track, feature.role, feature.reviewers], ['standard', 'developer', []]);
    assert.deepStrictEqual([policy.track, policy.role], ['rigorous', 'developer']);
    assert.deepStrictEqual(policy.reviewers, ['architecture-reviewer', 'security-reviewer', 'adversarial-reviewer']);
    assert.strictEqual(security.track, 'rigorous');
    const combos = new Set([docs, feature, policy].map((r) => `${r.track}|${r.role}|${r.reviewers.join(',')}`));
    assert.strictEqual(combos.size, 3);
  });

  it('every routed role exists in config/roles', () => {
    for (const type of Object.keys(dispatcher.WORK_TYPES)) {
      const r = dispatcher.routeItem({ id: 'x', type }, { roles });
      assert.strictEqual(r.ok, true, `${type}: ${r.message}`);
    }
  });

  it('rejects an unknown work type and an undefined role', () => {
    assert.strictEqual(dispatcher.routeItem({ id: 'x', type: 'misc' }, { roles }).code, 'UNKNOWN_WORK_TYPE');
    const noReviewers = new Map([...roles].filter(([id]) => id !== 'security-reviewer'));
    assert.strictEqual(dispatcher.routeItem({ id: 'x', type: 'policy' }, { roles: noReviewers }).code, 'ROLE_UNKNOWN');
  });

  it('policy track_rules raise a docs item touching protected paths to rigorous', () => {
    const policy = { track_rules: [{ pattern: 'config/roles/**', minimum_track: 'rigorous' }] };
    const r = dispatcher.routeItem({ id: 'x', type: 'docs', paths: ['config/roles/developer.json'] }, { policy, roles });
    assert.strictEqual(r.track, 'rigorous');
    assert.deepStrictEqual(r.reviewers, dispatcher.DESIGN_PANEL);
    assert.ok(r.reasons.some((s) => s.includes('track_rules')));
  });
});

describe('dispatch plan', () => {
  it('--dry-run returns the DAG and writes nothing', () => {
    const { project, goalDir } = makeProject();
    enqueue(goalDir, 'docs-a', 'docs');
    enqueue(goalDir, 'sec-c', 'security', { dependsOn: ['docs-a'] });
    dispatcher.approveItems({ goalDir, items: ['docs-a', 'sec-c'], identity: FOUNDER });
    const before = hashDir(goalDir);
    const worklogs = fs.readdirSync(path.join(project, '.worklogs')).sort();
    const r = dispatcher.plan({ goalDir, pluginRoot: root, dryRun: true });
    assert.strictEqual(r.ok, true, r.message);
    assert.deepStrictEqual(r.order, ['docs-a', 'sec-c']);
    assert.deepStrictEqual(r.nodes.find((n) => n.id === 'sec-c').depends_on, ['docs-a']);
    assert.deepStrictEqual(hashDir(goalDir), before);
    assert.deepStrictEqual(fs.readdirSync(path.join(project, '.worklogs')).sort(), worklogs);
  });

  it('a real plan is stored in goal.json and journaled as dispatch.planned', () => {
    const { goalDir } = makeProject();
    enqueue(goalDir, 'docs-a', 'docs');
    dispatcher.approveItems({ goalDir, items: ['docs-a'], identity: FOUNDER });
    const r = dispatcher.plan({ goalDir, pluginRoot: root, actor: 'hypervisor' });
    assert.strictEqual(r.ok, true, r.message);
    const goal = readGoal(goalDir);
    assert.deepStrictEqual(goal.dispatch.plan.order, ['docs-a']);
    assert.strictEqual(journalTypes(goalDir).at(-1), 'dispatch.planned');
    assert.match(fs.readFileSync(path.join(goalDir, 'audit.log'), 'utf8'), /action=dispatch_planned/);
  });

  it('plans only approved items and voids an approval when the item is edited', () => {
    const { goalDir } = makeProject();
    enqueue(goalDir, 'docs-a', 'docs');
    enqueue(goalDir, 'feature-b', 'feature');
    enqueue(goalDir, 'docs-c', 'docs');
    dispatcher.approveItems({ goalDir, items: ['docs-a', 'docs-c'], identity: FOUNDER });
    const goal = readGoal(goalDir);
    goal.discovery.queue.find((i) => i.id === 'docs-c').title = 'something else';
    fs.writeFileSync(path.join(goalDir, 'goal.json'), JSON.stringify(goal, null, 2));
    const r = dispatcher.plan({ goalDir, pluginRoot: root, dryRun: true });
    assert.strictEqual(r.ok, true, r.message);
    assert.deepStrictEqual(r.order, ['docs-a']);
    assert.deepStrictEqual(r.skipped, [
      { id: 'feature-b', reason: 'not approved' },
      { id: 'docs-c', reason: 'approval does not match item content' },
    ]);
  });

  it('rejects an approval that is not from a user identity', () => {
    const { goalDir } = makeProject();
    enqueue(goalDir, 'docs-a', 'docs');
    assert.strictEqual(dispatcher.approveItems({ goalDir, items: ['docs-a'], identity: { actor: 'hypervisor' } }).code, 'NO_IDENTITY');
  });

  it('rejects cycles, unknown dependencies, and dependencies on unapproved items', () => {
    const cyc = makeProject();
    enqueue(cyc.goalDir, 'a', 'docs', { dependsOn: ['b'] });
    enqueue(cyc.goalDir, 'b', 'docs', { dependsOn: ['a'] });
    dispatcher.approveItems({ goalDir: cyc.goalDir, items: ['a', 'b'], identity: FOUNDER });
    assert.strictEqual(dispatcher.plan({ goalDir: cyc.goalDir, pluginRoot: root, dryRun: true }).code, 'DAG_CYCLE');

    const unknown = makeProject();
    enqueue(unknown.goalDir, 'a', 'docs', { dependsOn: ['ghost'] });
    dispatcher.approveItems({ goalDir: unknown.goalDir, items: ['a'], identity: FOUNDER });
    const u = dispatcher.plan({ goalDir: unknown.goalDir, pluginRoot: root, dryRun: true });
    assert.strictEqual(u.code, 'PLAN_INVALID');
    assert.match(u.message, /unknown item ghost/);

    const unapproved = makeProject();
    enqueue(unapproved.goalDir, 'a', 'docs');
    enqueue(unapproved.goalDir, 'b', 'docs', { dependsOn: ['a'] });
    dispatcher.approveItems({ goalDir: unapproved.goalDir, items: ['b'], identity: FOUNDER });
    assert.match(dispatcher.plan({ goalDir: unapproved.goalDir, pluginRoot: root, dryRun: true }).message, /unapproved item a/);
  });

  it('rejects a goal id that would escape .worklogs when naming child dirs', () => {
    const goal = { goal_id: '../evil', current_state: 'goal-discovery', discovery: { queue: [] } };
    assert.strictEqual(dispatcher.planDispatch({ goal }).code, 'GOAL_ID_INVALID');
  });

  it('refuses to plan before discovery', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-test-'));
    spawnSync(process.execPath, [path.join(root, 'scripts', 'goal-engine.cjs'), 'init', '--id', 'g1', '--objective', 'x', '--work-root', project], { env: cleanEnv });
    const r = dispatcher.plan({ goalDir: path.join(project, '.worklogs', 'goals', 'g1'), pluginRoot: root, dryRun: true });
    assert.strictEqual(r.code, 'GOAL_STATE');
  });

  it('enqueue rejects duplicate ids and unknown types', () => {
    const { goalDir } = makeProject();
    enqueue(goalDir, 'a', 'docs');
    assert.strictEqual(dispatcher.enqueue({ goalDir, actor: 'h', id: 'a', type: 'docs', title: 't' }).code, 'QUEUE_INVALID');
    assert.strictEqual(dispatcher.enqueue({ goalDir, actor: 'h', id: 'b', type: 'misc', title: 't' }).code, 'QUEUE_INVALID');
  });
});

describe('dispatch start (dependency ordering)', () => {
  it('a child cannot start before its predecessor reaches completed', () => {
    const { project, goalDir } = plannedChain();
    const blocked = dispatcher.start({ goalDir, pluginRoot: root, actor: 'hypervisor', item: 'feature-b' });
    assert.strictEqual(blocked.code, 'DISPATCH_BLOCKED');
    assert.deepStrictEqual(blocked.waiting_on, ['docs-a']);
    assert.strictEqual(fs.existsSync(childDir(project, 'feature-b')), false);

    const a = dispatcher.start({ goalDir, pluginRoot: root, actor: 'hypervisor' });
    assert.strictEqual(a.ok, true, a.message);
    assert.strictEqual(a.item, 'docs-a');
    const childState = JSON.parse(fs.readFileSync(path.join(a.workDir, 'state.json'), 'utf8'));
    assert.strictEqual(childState.pipeline.track, 'lean');

    assert.strictEqual(dispatcher.start({ goalDir, pluginRoot: root, actor: 'hypervisor' }).code, 'DISPATCH_BUSY');

    advanceChild(a.workDir, 'feasibility');
    assert.strictEqual(dispatcher.start({ goalDir, pluginRoot: root, actor: 'hypervisor', item: 'feature-b' }).code, 'DISPATCH_BUSY');
    advanceChild(a.workDir, 'completed');

    const b = dispatcher.start({ goalDir, pluginRoot: root, actor: 'hypervisor' });
    assert.strictEqual(b.ok, true, b.message);
    assert.strictEqual(b.item, 'feature-b');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(b.workDir, 'state.json'), 'utf8')).pipeline.track, 'standard');

    const goal = readGoal(goalDir);
    assert.deepStrictEqual(goal.children.map((c) => [c.item_id, c.track, c.role]), [
      ['docs-a', 'lean', 'developer'],
      ['feature-b', 'standard', 'developer'],
    ]);
    assert.strictEqual(goal.budget.child_items_used, 2);
  });

  it('a failed predecessor keeps its dependants blocked', () => {
    const { goalDir } = plannedChain();
    const a = dispatcher.start({ goalDir, pluginRoot: root, actor: 'hypervisor' });
    advanceChild(a.workDir, 'feasibility');
    advanceChild(a.workDir, 'pipeline-failed');
    const r = dispatcher.start({ goalDir, pluginRoot: root, actor: 'hypervisor', item: 'feature-b' });
    assert.strictEqual(r.code, 'DISPATCH_BLOCKED');
    const s = dispatcher.status({ goalDir });
    assert.deepStrictEqual(s.nodes.map((n) => n.status), ['failed', 'blocked']);
  });

  it('children start only in goal-execute and within the goal budget', () => {
    const ctx = makeProject();
    enqueue(ctx.goalDir, 'a', 'docs');
    enqueue(ctx.goalDir, 'b', 'docs');
    dispatcher.approveItems({ goalDir: ctx.goalDir, items: ['a', 'b'], identity: FOUNDER });
    dispatcher.plan({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    assert.strictEqual(dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' }).code, 'GOAL_STATE');
    goTo(ctx.goalDir, 'goal-execute');

    const goal = readGoal(ctx.goalDir);
    goal.budget.max_child_items = 1;
    fs.writeFileSync(path.join(ctx.goalDir, 'goal.json'), JSON.stringify(goal, null, 2));
    const a = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    assert.strictEqual(a.ok, true, a.message);
    advanceChild(a.workDir, 'completed');
    assert.strictEqual(dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' }).code, 'GOAL_BUDGET_STOP');
  });

  it('reports DISPATCH_DONE once every child is completed', () => {
    const { goalDir } = plannedChain();
    for (let i = 0; i < 2; i++) {
      const c = dispatcher.start({ goalDir, pluginRoot: root, actor: 'hypervisor' });
      advanceChild(c.workDir, 'completed');
    }
    assert.strictEqual(dispatcher.start({ goalDir, pluginRoot: root, actor: 'hypervisor' }).code, 'DISPATCH_DONE');
  });
});

describe('dispatch resume (interrupted child)', () => {
  function interruptedB() {
    const ctx = plannedChain();
    const a = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    advanceChild(a.workDir, 'feasibility');
    advanceChild(a.workDir, 'completed');
    const b = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    advanceChild(b.workDir, 'feasibility');
    advanceChild(b.workDir, 'lean-track-check', { writeState: false });
    return { ...ctx, aDir: a.workDir, bDir: b.workDir };
  }

  it('rebuilds state.json from the journal without touching the completed predecessor', () => {
    const { goalDir, aDir, bDir } = interruptedB();
    const s = dispatcher.status({ goalDir });
    assert.deepStrictEqual(s.nodes.map((n) => n.status), ['completed', 'interrupted']);
    assert.strictEqual(dispatcher.start({ goalDir, pluginRoot: root, actor: 'hypervisor' }).code, 'DISPATCH_BUSY');

    const aBefore = hashDir(aDir);
    const aEvents = readJournal(aDir).events.length;
    const r = dispatcher.resume({ goalDir, item: 'feature-b', actor: 'hypervisor' });
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(r.recovered, true);
    assert.strictEqual(r.current_state, 'lean-track-check');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(bDir, 'state.json'), 'utf8')).current_state, 'lean-track-check');
    assert.deepStrictEqual(hashDir(aDir), aBefore);
    assert.strictEqual(readJournal(aDir).events.length, aEvents);
    assert.deepStrictEqual(dispatcher.status({ goalDir }).nodes.map((n) => n.status), ['completed', 'active']);
  });

  it('recovers a child whose state.json was lost', () => {
    const { goalDir, bDir } = interruptedB();
    fs.unlinkSync(path.join(bDir, 'state.json'));
    const r = dispatcher.resume({ goalDir, item: 'feature-b', actor: 'hypervisor' });
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(r.current_state, 'lean-track-check');
  });

  it('refuses to resume a completed or never-started child', () => {
    const { goalDir } = interruptedB();
    assert.strictEqual(dispatcher.resume({ goalDir, item: 'docs-a', actor: 'hypervisor' }).code, 'DISPATCH_NOTHING_TO_RESUME');
    const fresh = plannedChain();
    assert.strictEqual(dispatcher.resume({ goalDir: fresh.goalDir, item: 'docs-a', actor: 'hypervisor' }).code, 'DISPATCH_NOT_STARTED');
  });

  it('refuses to resume a child with a corrupt journal', () => {
    const { goalDir, bDir } = interruptedB();
    const file = path.join(bDir, 'journal.jsonl');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"feasibility"', '"validation"'));
    assert.strictEqual(dispatcher.resume({ goalDir, item: 'feature-b', actor: 'hypervisor' }).code, 'INTEGRITY_FAILED');
  });
});

describe('dispatch journal', () => {
  it('every decision, including refusals, is a dispatch.* goal journal event', () => {
    const { goalDir } = plannedChain();
    dispatcher.start({ goalDir, pluginRoot: root, actor: 'hypervisor', item: 'feature-b' });
    const a = dispatcher.start({ goalDir, pluginRoot: root, actor: 'hypervisor' });
    advanceChild(a.workDir, 'feasibility', { writeState: false });
    dispatcher.resume({ goalDir, item: 'docs-a', actor: 'hypervisor' });
    const types = journalTypes(goalDir).filter((t) => t.startsWith('dispatch.'));
    assert.deepStrictEqual(types, [
      'dispatch.enqueued',
      'dispatch.enqueued',
      'dispatch.approved',
      'dispatch.planned',
      'dispatch.refused',
      'dispatch.started',
      'dispatch.resumed',
    ]);
    const decisions = readGoal(goalDir).dispatch.decisions;
    assert.deepStrictEqual(decisions.map((d) => d.decision), ['enqueued', 'enqueued', 'approved', 'planned', 'refused', 'started', 'resumed']);
    assert.strictEqual(decisions[4].code, 'DISPATCH_BLOCKED');
    assert.strictEqual(decisions[2].actor, FOUNDER.actor);
    const v = spawnSync(process.execPath, [path.join(root, 'scripts', 'goal-engine.cjs'), 'validate', '--goal-dir', goalDir, '--json'], { encoding: 'utf8', env: cleanEnv });
    assert.strictEqual(JSON.parse(v.stdout).verdict, 'VALID');
  });
});

describe('dispatch CLI', () => {
  const bin = path.join(root, 'bin', 'agentic-swe.cjs');

  it('agentic-swe dispatch plan --dry-run prints the DAG as JSON', () => {
    const { goalDir } = makeProject();
    enqueue(goalDir, 'docs-a', 'docs');
    dispatcher.approveItems({ goalDir, items: ['docs-a'], identity: FOUNDER });
    const before = hashDir(goalDir);
    const r = spawnSync(process.execPath, [bin, 'dispatch', 'plan', '--goal-dir', goalDir, '--dry-run', '--json'], { encoding: 'utf8', env: cleanEnv });
    assert.strictEqual(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.dryRun, true);
    assert.deepStrictEqual(out.order, ['docs-a']);
    assert.deepStrictEqual(hashDir(goalDir), before);
  });

  it('dispatch approve refuses in an agent session', () => {
    const { goalDir } = makeProject();
    enqueue(goalDir, 'docs-a', 'docs');
    const r = spawnSync(process.execPath, [bin, 'dispatch', 'approve', '--goal-dir', goalDir, '--item', 'docs-a', '--json'], {
      encoding: 'utf8',
      env: { ...cleanEnv, CURSOR_AGENT: '1' },
    });
    assert.strictEqual(r.status, 3);
    assert.strictEqual(JSON.parse(r.stdout).code, 'AGENT_CONTEXT');
  });

  it('enqueue + plan without --actor is rejected', () => {
    const { goalDir } = makeProject();
    const r = spawnSync(process.execPath, [bin, 'dispatch', 'plan', '--goal-dir', goalDir, '--json'], { encoding: 'utf8', env: cleanEnv });
    assert.strictEqual(r.status, 1);
    assert.strictEqual(JSON.parse(r.stdout).code, 'MISSING_ACTOR');
  });
});
