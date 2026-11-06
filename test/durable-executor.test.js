'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const dispatcher = require('../scripts/lib/dispatch/dispatcher.cjs');
const { applyGoalTransition } = require('../scripts/lib/work-engine/goal.cjs');
const { commitState, readJournal } = require('../scripts/lib/shared/journal.cjs');

function project(items, budget = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'executor-test-'));
  const r = spawnSync(process.execPath, [
    path.join(root, 'scripts/goal-engine.cjs'), 'init', '--id', 'g1', '--objective', 'executor',
    '--work-root', dir, '--plugin-root', root, '--json',
  ], { encoding: 'utf8', env: { ...process.env, AGENTIC_SWE_POLICY: undefined } });
  assert.strictEqual(r.status, 0, r.stderr);
  const goalDir = path.join(dir, '.worklogs/goals/g1');
  assert.strictEqual(applyGoalTransition({ goalDir, pluginRoot: root, to: 'goal-discovery', actor: 'hypervisor' }).ok, true);
  for (const item of items) {
    assert.strictEqual(dispatcher.enqueue({ goalDir, actor: 'hypervisor', title: item.id, ...item }).ok, true);
  }
  assert.strictEqual(dispatcher.approveItems({ goalDir, items: items.map((x) => x.id), identity: { actor: 'user:test@example.com' } }).ok, true);
  assert.strictEqual(dispatcher.plan({ goalDir, pluginRoot: root, actor: 'hypervisor' }).ok, true);
  assert.strictEqual(applyGoalTransition({ goalDir, pluginRoot: root, to: 'goal-execute', actor: 'hypervisor' }).ok, true);
  const goal = JSON.parse(fs.readFileSync(path.join(goalDir, 'goal.json'), 'utf8'));
  Object.assign(goal.budget, budget);
  fs.writeFileSync(path.join(goalDir, 'goal.json'), `${JSON.stringify(goal, null, 2)}\n`);
  return { dir, goalDir };
}

function advance(workDir, to, extra = {}) {
  const statePath = path.join(workDir, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const from = state.current_state;
  state.current_state = to;
  Object.assign(state, extra);
  state.history = [...(state.history || []), { at: new Date().toISOString(), actor: 'hypervisor', from, to }];
  const snapshot = commitState(workDir, state, { type: 'transition', expectCurrent: from });
  fs.writeFileSync(statePath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

function childDir(dir, item, attempt = 1) {
  return path.join(dir, '.worklogs', `g1--${item}${attempt > 1 ? `.a${attempt}` : ''}`);
}

describe('durable executor', () => {
  it('starts A and B in parallel but blocks C until both complete', () => {
    const ctx = project([
      { id: 'a', type: 'docs', dependsOn: [] },
      { id: 'b', type: 'docs', dependsOn: [] },
      { id: 'c', type: 'feature', dependsOn: ['a', 'b'] },
    ], { max_parallel: 2 });
    const a = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    const b = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    assert.strictEqual(a.ok, true);
    assert.strictEqual(b.ok, true);
    assert.strictEqual(dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', item: 'c' }).code, 'DISPATCH_BLOCKED');
    advance(a.workDir, 'completed');
    assert.strictEqual(dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', item: 'c' }).code, 'DISPATCH_BLOCKED');
    advance(b.workDir, 'completed');
    assert.strictEqual(dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', item: 'c' }).ok, true);
  });

  it('reconciles a write-ahead start without duplicating the child', () => {
    const ctx = project([{ id: 'a', type: 'docs', dependsOn: [] }]);
    const goalPath = path.join(ctx.goalDir, 'goal.json');
    const goal = JSON.parse(fs.readFileSync(goalPath, 'utf8'));
    const node = goal.dispatch.plan.nodes[0];
    const workDir = childDir(ctx.dir, 'a');
    const init = spawnSync(process.execPath, [
      path.join(root, 'scripts/work-engine.cjs'), 'init', '--id', node.work_id, '--task', 'crash',
      '--work-root', ctx.dir, '--budget-profile', 'lean', '--plugin-root', root, '--json',
    ], { encoding: 'utf8' });
    assert.strictEqual(init.status, 0, init.stderr);
    goal.children = [{ work_id: node.work_id, item_id: 'a', status: 'starting', attempt: 1, attempt_work_id: node.work_id }];
    goal.dispatch.decisions.push({ at: new Date().toISOString(), actor: 'hypervisor', decision: 'starting', item: 'a' });
    fs.writeFileSync(goalPath, `${JSON.stringify(goal, null, 2)}\n`);
    const r = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(fs.existsSync(workDir), true);
    assert.strictEqual(readJournal(ctx.goalDir).events.filter((e) => e.type === 'dispatch.started').length, 1);
  });

  it('cancels cooperatively and refuses restart without new approval', () => {
    const ctx = project([{ id: 'a', type: 'docs', dependsOn: [] }]);
    assert.strictEqual(dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' }).ok, true);
    assert.strictEqual(dispatcher.cancel({ goalDir: ctx.goalDir, actor: 'hypervisor' }).ok, true);
    const r = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', item: 'a' });
    assert.strictEqual(r.code, 'CHILD_CANCELLED');
    assert.strictEqual(readJournal(ctx.goalDir).events.at(-1).type, 'dispatch.refused');
  });

  it('retries only an explicitly retryable pipeline failure and respects attempts', () => {
    const ctx = project([{ id: 'a', type: 'docs', dependsOn: [] }], { max_attempts: 2 });
    const first = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    advance(first.workDir, 'pipeline-failed', { failure_code: 'TIMEOUT' });
    const second = dispatcher.retry({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', item: 'a' });
    assert.strictEqual(second.ok, true, second.message);
    assert.strictEqual(second.attempt, 2);
    advance(second.workDir, 'pipeline-failed', { failure_code: 'AUTH_DENIED' });
    assert.strictEqual(dispatcher.retry({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', item: 'a' }).code, 'RETRY_NOT_ALLOWED');
  });

  it('keeps approval bound to the immutable item hash and accounts parallel cost once', () => {
    const ctx = project([
      { id: 'a', type: 'docs', dependsOn: [], cost_usd: 0 },
      { id: 'b', type: 'docs', dependsOn: [], cost_usd: 0 },
    ], { max_parallel: 2, cost_budget_usd: 1 });
    const a = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    const b = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    assert.strictEqual(a.ok, true);
    assert.strictEqual(b.ok, true);
    const goal = JSON.parse(fs.readFileSync(path.join(ctx.goalDir, 'goal.json'), 'utf8'));
    assert.strictEqual(goal.budget.child_items_used, 2);
    assert.strictEqual(goal.budget.cost_used, 0);
    goal.discovery.queue[0].title = 'changed';
    fs.writeFileSync(path.join(ctx.goalDir, 'goal.json'), `${JSON.stringify(goal, null, 2)}\n`);
    assert.strictEqual(dispatcher.plan({ goalDir: ctx.goalDir, pluginRoot: root, dryRun: true }).code, 'PLAN_DROPS_STARTED');
  });
});
