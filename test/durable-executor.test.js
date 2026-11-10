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
const { commitState, readJournal, appendEvent } = require('../scripts/lib/shared/journal.cjs');

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
  it('F-M2-01b: trailing side events after the last snapshot keep the child active', () => {
    const ctx = project([{ id: 'a', type: 'docs', dependsOn: [] }]);
    const a = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    assert.strictEqual(a.ok, true);
    assert.strictEqual(dispatcher.childStatus(a.workDir).status, 'active');
    appendEvent(a.workDir, {
      type: 'policy.decided',
      payload: { decision: 'allow', rule_id: 'tool.read', policy_digest: 'a'.repeat(64), tool_name: 'test', input_summary: 'x' },
      idempotency_key: 'policy:side-1',
    });
    appendEvent(a.workDir, {
      type: 'tool.requested',
      payload: { tool_id: 'test', policy_decision_ref: { seq: 2 } },
      idempotency_key: 'requested:side-1',
    });
    const s = dispatcher.childStatus(a.workDir);
    assert.strictEqual(s.status, 'active', JSON.stringify(s));
    advance(a.workDir, 'completed');
    appendEvent(a.workDir, {
      type: 'policy.decided',
      payload: { decision: 'allow', rule_id: 'tool.read', policy_digest: 'a'.repeat(64), tool_name: 'test', input_summary: 'y' },
      idempotency_key: 'policy:side-2',
    });
    assert.strictEqual(dispatcher.childStatus(a.workDir).status, 'completed');
  });

  it('F-M2-01b: a stale state.json behind a newer snapshot is still interrupted', () => {
    const ctx = project([{ id: 'a', type: 'docs', dependsOn: [] }]);
    const a = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    const statePath = path.join(a.workDir, 'state.json');
    const before = fs.readFileSync(statePath, 'utf8');
    advance(a.workDir, 'feasibility');
    fs.writeFileSync(statePath, before);
    assert.strictEqual(dispatcher.childStatus(a.workDir).status, 'interrupted');
  });

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

  it('F-M2-02: resume refuses when the pinned engine digest differs', () => {
    const ctx = project([{ id: 'a', type: 'docs', dependsOn: [] }]);
    const a = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    assert.strictEqual(a.ok, true);
    const statePath = path.join(a.workDir, 'state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    assert.ok(state.pipeline && state.pipeline.state_machine_digests);
    state.pipeline = {
      ...state.pipeline,
      state_machine_digests: {
        ...state.pipeline.state_machine_digests,
        'state-machine.json': '0'.repeat(64),
      },
    };
    const snapshot = commitState(a.workDir, state, { type: 'transition', expectCurrent: state.current_state });
    fs.writeFileSync(statePath, `${JSON.stringify(snapshot, null, 2)}\n`);
    const refused = dispatcher.resume({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', item: 'a' });
    assert.strictEqual(refused.ok, false);
    assert.strictEqual(refused.code, 'ENGINE_VERSION_MISMATCH');
  });

  it('F-M2-02: resume succeeds when the pin still matches', () => {
    const ctx = project([{ id: 'a', type: 'docs', dependsOn: [] }]);
    const a = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    assert.strictEqual(a.ok, true);
    const resumed = dispatcher.resume({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', item: 'a' });
    assert.strictEqual(resumed.ok, true, JSON.stringify(resumed));
  });

  it('F-M2-07 AC4: gate and escalate children refuse resume and retry', () => {
    for (const terminal of [
      { state: 'approval-wait', status: 'gate', resumeCode: 'DISPATCH_NOTHING_TO_RESUME' },
      { state: 'ambiguity-wait', status: 'gate', resumeCode: 'DISPATCH_NOTHING_TO_RESUME' },
      { state: 'escalate-code', status: 'escalated', resumeCode: 'DISPATCH_NOTHING_TO_RESUME' },
    ]) {
      const ctx = project([{ id: 'a', type: 'docs', dependsOn: [] }]);
      const a = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
      advance(a.workDir, terminal.state);
      assert.strictEqual(dispatcher.childStatus(a.workDir).status, terminal.status);
      const resumed = dispatcher.resume({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', item: 'a' });
      assert.strictEqual(resumed.ok, false, terminal.state);
      assert.strictEqual(resumed.code, terminal.resumeCode);
      const retried = dispatcher.retry({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', item: 'a' });
      assert.strictEqual(retried.ok, false, terminal.state);
      assert.strictEqual(retried.code, 'RETRY_NOT_ALLOWED');
    }
  });

  it('F-M2-07 AC5: goalJournalStatuses equals the journal view exposed by status()', () => {
    const ctx = project([{ id: 'a', type: 'docs', dependsOn: [] }]);
    const a = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    assert.strictEqual(a.ok, true);
    const goal = JSON.parse(fs.readFileSync(path.join(ctx.goalDir, 'goal.json'), 'utf8'));
    const fromFn = dispatcher.goalJournalStatuses(goal, goal.dispatch.plan);
    const st = dispatcher.status({ goalDir: ctx.goalDir });
    assert.strictEqual(st.ok, true);
    assert.deepStrictEqual(st.journal_statuses.a, fromFn.get('a'));
    assert.strictEqual(st.journal_statuses.a.status, 'started');
    assert.strictEqual(st.nodes[0].status, 'active');
    assert.strictEqual(st.nodes[0].journal.status, 'started');
  });

  it('F-M2-07 AC6: decomposed sub-items enter the queue unapproved', () => {
    const ctx = project([{ id: 'parent', type: 'feature', dependsOn: [] }]);
    const d = dispatcher.decompose({
      goalDir: ctx.goalDir,
      actor: 'hypervisor',
      parent: 'parent',
      items: [
        { id: 'child-a', type: 'docs', title: 'part a' },
        { id: 'child-b', type: 'docs', title: 'part b' },
      ],
    });
    assert.strictEqual(d.ok, true, JSON.stringify(d));
    assert.strictEqual(d.items.length, 2);
    assert.ok(d.items.every((i) => i.approved === false && i.item_hash));
    const goal = JSON.parse(fs.readFileSync(path.join(ctx.goalDir, 'goal.json'), 'utf8'));
    const queued = goal.discovery.queue.filter((i) => i.id === 'child-a' || i.id === 'child-b');
    assert.strictEqual(queued.length, 2);
    assert.ok(queued.every((i) => !dispatcher.isApproved(i)));
    const planned = dispatcher.plan({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', dryRun: true });
    assert.ok(planned.skipped.some((s) => s.id === 'child-a' && /not approved/.test(s.reason)));
  });

  it('F-M2-07: not_before backoff is enforced on the next start reconcile', () => {
    const ctx = project([{ id: 'a', type: 'docs', dependsOn: [] }]);
    const goalPath = path.join(ctx.goalDir, 'goal.json');
    const goal = JSON.parse(fs.readFileSync(goalPath, 'utf8'));
    const node = goal.dispatch.plan.nodes[0];
    const notBefore = new Date(Date.now() + 60_000).toISOString();
    // Simulate a write-ahead retry left behind with backoff still active.
    goal.children = [{
      work_id: node.work_id,
      item_id: 'a',
      status: 'starting',
      attempt: 2,
      attempt_work_id: node.work_id,
      not_before: notBefore,
    }];
    fs.writeFileSync(goalPath, `${JSON.stringify(goal, null, 2)}\n`);
    const blocked = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', item: 'a' });
    assert.strictEqual(blocked.ok, false, JSON.stringify(blocked));
    assert.strictEqual(blocked.code, 'RETRY_BACKOFF');
    assert.strictEqual(blocked.not_before, notBefore);
  });

  it('F-M2-07: item-scoped cancel leaves sibling children startable', () => {
    const ctx = project([
      { id: 'a', type: 'docs', dependsOn: [] },
      { id: 'b', type: 'docs', dependsOn: [] },
    ], { max_parallel: 2 });
    const a = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor' });
    assert.strictEqual(a.ok, true);
    const cancelled = dispatcher.cancel({ goalDir: ctx.goalDir, actor: 'hypervisor', item: 'a' });
    assert.strictEqual(cancelled.ok, true);
    assert.strictEqual(cancelled.item, 'a');
    const goal = JSON.parse(fs.readFileSync(path.join(ctx.goalDir, 'goal.json'), 'utf8'));
    assert.strictEqual(goal.dispatch.cancelled_epoch || 0, 0, 'item cancel must not bump global epoch');
    const b = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', item: 'b' });
    assert.strictEqual(b.ok, true, JSON.stringify(b));
    const again = dispatcher.start({ goalDir: ctx.goalDir, pluginRoot: root, actor: 'hypervisor', item: 'a' });
    assert.strictEqual(again.code, 'CHILD_CANCELLED');
  });

});
