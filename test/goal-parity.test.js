'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { applyGoalTransition, loadGoal } = require('../scripts/lib/work-engine/goal.cjs');
const { recordGoalApproval } = require('../scripts/lib/work-engine/goal-approval.cjs');
const { verifyWorkJournal } = require('../scripts/lib/work-engine/journal.cjs');
const { acquireWriteLockSync, releaseWriteLockSync } = require('../scripts/lib/work-engine/state-lock.cjs');

const root = path.join(__dirname, '..');
const identity = { actor: 'user:tester@example.com', name: 'Tester', email: 'tester@example.com', os_user: 'tester' };

function makeGoalDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-parity-'));
  const tpl = fs.readFileSync(path.join(root, 'templates', 'goal.json'), 'utf8');
  const now = new Date().toISOString();
  const raw = tpl
    .replace('<goal-id>', 'test-goal')
    .replace('<goal statement>', 'make tests pass')
    .replace(/<ISO-8601 timestamp>/g, now);
  fs.writeFileSync(path.join(dir, 'goal.json'), raw);
  return dir;
}

function readGoal(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'goal.json'), 'utf8'));
}

function advance(dir, to) {
  const r = applyGoalTransition({ goalDir: dir, pluginRoot: root, to, actor: 'hypervisor' });
  assert.strictEqual(r.ok, true, r.message);
  return r;
}

describe('goal budget parity', () => {
  it('rejects a transition once any budget counter has reached its cap', () => {
    for (const [used, cap] of [
      ['loop_turns_used', 'max_loop_turns'],
      ['child_items_used', 'max_child_items'],
      ['cost_used', 'cost_budget_usd'],
    ]) {
      const dir = makeGoalDir();
      const goal = readGoal(dir);
      goal.budget[used] = goal.budget[cap];
      fs.writeFileSync(path.join(dir, 'goal.json'), JSON.stringify(goal));
      const r = applyGoalTransition({ goalDir: dir, pluginRoot: root, to: 'goal-discovery', actor: 'hypervisor' });
      assert.strictEqual(r.ok, false, used);
      assert.strictEqual(r.code, 'GOAL_BUDGET_STOP');
      assert.strictEqual(readGoal(dir).current_state, 'goal-initialized');
      assert.strictEqual(readGoal(dir).history.length, 0);
    }
  });
});

describe('goal approval and journal', () => {
  it('journals each transition and rejects a current_state the journal does not project', () => {
    const dir = makeGoalDir();
    advance(dir, 'goal-discovery');
    const chain = verifyWorkJournal(dir, { stateFile: 'goal.json' });
    assert.strictEqual(chain.ok, true);
    assert.strictEqual(chain.events.length, 1);
    assert.strictEqual(chain.events[0].state.current_state, 'goal-discovery');

    const edited = readGoal(dir);
    edited.current_state = 'goal-execute';
    fs.writeFileSync(path.join(dir, 'goal.json'), JSON.stringify(edited));
    const r = applyGoalTransition({ goalDir: dir, pluginRoot: root, to: 'goal-verify', actor: 'hypervisor' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'INTEGRITY_FAILED');
  });

  it('takes the write lock', () => {
    const dir = makeGoalDir();
    const held = acquireWriteLockSync(dir);
    try {
      const r = applyGoalTransition({
        goalDir: dir,
        pluginRoot: root,
        to: 'goal-discovery',
        actor: 'hypervisor',
        lock: { maxAttempts: 1, baseDelayMs: 0 },
      });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.code, 'LOCK_TIMEOUT');
      assert.strictEqual(readGoal(dir).current_state, 'goal-initialized');
    } finally {
      releaseWriteLockSync(held);
    }
  });

  it('requires a human approval record to leave goal-approval, and journals that approval', () => {
    const dir = makeGoalDir();
    advance(dir, 'goal-discovery');
    advance(dir, 'goal-execute');
    advance(dir, 'goal-verify');
    advance(dir, 'goal-approval');

    const blocked = applyGoalTransition({ goalDir: dir, pluginRoot: root, to: 'goal-met', actor: 'hypervisor' });
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.code, 'HUMAN_APPROVAL_REQUIRED');
    assert.strictEqual(readGoal(dir).current_state, 'goal-approval');

    const approved = recordGoalApproval({ goalDir: dir, pluginRoot: root, decision: 'approved', identity });
    assert.strictEqual(approved.ok, true, approved.message);
    const goal = readGoal(dir);
    assert.strictEqual(goal.current_state, 'goal-met');
    assert.strictEqual(goal.gates.goal_approved, true);
    const chain = verifyWorkJournal(dir, { stateFile: 'goal.json' });
    assert.strictEqual(chain.ok, true);
    assert.strictEqual(chain.events[chain.events.length - 1].type, 'approve');
    assert.strictEqual(chain.events.some((event) => event.type === 'transition' && event.state.current_state === 'goal-met'), true);
  });

  it('CLI goal approve refuses an agent session', () => {
    const dir = makeGoalDir();
    const r = spawnSync(
      process.execPath,
      [path.join(root, 'scripts', 'goal-engine.cjs'), 'approve', '--goal-dir', dir, '--decision', 'approved', '--json'],
      { encoding: 'utf8', env: { ...process.env, CLAUDECODE: '1' } }
    );
    assert.notStrictEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.code, 'AGENT_CONTEXT');
    assert.ok(!fs.existsSync(path.join(dir, 'approval-record.json')));
  });
});
