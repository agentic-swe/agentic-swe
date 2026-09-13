'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  loadGoalEdges,
  assertGoalEdge,
  validateGoalShape,
  loadGoal,
  applyGoalTransition,
} = require('../scripts/lib/work-engine/goal.cjs');

const root = path.join(__dirname, '..');

function makeGoalDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-test-'));
  const tpl = fs.readFileSync(path.join(root, 'templates', 'goal.json'), 'utf8');
  const now = new Date().toISOString();
  const raw = tpl
    .replace('<goal-id>', 'test-goal')
    .replace('<goal statement>', 'make tests pass')
    .replace(/<ISO-8601 timestamp>/g, now);
  fs.writeFileSync(path.join(dir, 'goal.json'), raw);
  return dir;
}

describe('goal engine edges', () => {
  it('loads canonical outer edges + terminal + gates', () => {
    const { edges, terminal, gates } = loadGoalEdges(root);
    assert.ok(edges.has('goal-initialized\0goal-discovery'));
    assert.ok(terminal.has('goal-met'));
    assert.ok(terminal.has('goal-failed'));
    assert.ok(gates.has('goal-approval'));
  });

  it('allows a valid edge and rejects an invalid one', () => {
    assert.strictEqual(assertGoalEdge(root, 'goal-execute', 'goal-verify').ok, true);
    assert.strictEqual(assertGoalEdge(root, 'goal-initialized', 'goal-met').ok, false);
  });
});

describe('goal shape validation', () => {
  it('accepts the template shape', () => {
    const loaded = loadGoal(makeGoalDir());
    assert.strictEqual(loaded.ok, true);
    assert.strictEqual(validateGoalShape(loaded.goal).ok, true);
  });

  it('rejects a goal missing required fields', () => {
    const r = validateGoalShape({ goal_id: 'x' });
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.length > 0);
  });
});

describe('goal transition apply', () => {
  it('commits a legal transition and appends history', () => {
    const dir = makeGoalDir();
    const r = applyGoalTransition({
      goalDir: dir,
      pluginRoot: root,
      to: 'goal-discovery',
      actor: 'hypervisor',
      reason: 'start',
    });
    assert.strictEqual(r.ok, true);
    const goal = JSON.parse(fs.readFileSync(path.join(dir, 'goal.json'), 'utf8'));
    assert.strictEqual(goal.current_state, 'goal-discovery');
    assert.strictEqual(goal.history.length, 1);
    assert.strictEqual(goal.history[0].to, 'goal-discovery');
    assert.strictEqual(goal.budget.loop_turns_used, 1);
  });

  it('rejects an illegal transition without mutating goal.json', () => {
    const dir = makeGoalDir();
    const r = applyGoalTransition({
      goalDir: dir,
      pluginRoot: root,
      to: 'goal-met',
      actor: 'hypervisor',
    });
    assert.strictEqual(r.ok, false);
    const goal = JSON.parse(fs.readFileSync(path.join(dir, 'goal.json'), 'utf8'));
    assert.strictEqual(goal.current_state, 'goal-initialized');
    assert.strictEqual(goal.history.length, 0);
  });

  it('dry-run does not mutate goal.json', () => {
    const dir = makeGoalDir();
    const r = applyGoalTransition({
      goalDir: dir,
      pluginRoot: root,
      to: 'goal-discovery',
      actor: 'hypervisor',
      dryRun: true,
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.dryRun, true);
    const goal = JSON.parse(fs.readFileSync(path.join(dir, 'goal.json'), 'utf8'));
    assert.strictEqual(goal.current_state, 'goal-initialized');
    assert.strictEqual(goal.history.length, 0);
  });
});

describe('goal-engine CLI', () => {
  it('init creates goal.json; illegal transition exits non-zero, legal exits zero', () => {
    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-cli-'));
    const cli = path.join(root, 'scripts', 'goal-engine.cjs');

    const init = spawnSync(
      process.execPath,
      [cli, 'init', '--id', 'g1', '--objective', 'x', '--work-root', workRoot, '--plugin-root', root, '--json'],
      { encoding: 'utf8' }
    );
    assert.strictEqual(init.status, 0, init.stderr);
    const goalDir = path.join(workRoot, '.worklogs', 'goals', 'g1');
    assert.ok(fs.existsSync(path.join(goalDir, 'goal.json')));

    const bad = spawnSync(
      process.execPath,
      [cli, 'transition', '--goal-dir', goalDir, '--to', 'goal-met', '--actor', 'hypervisor', '--plugin-root', root],
      { encoding: 'utf8' }
    );
    assert.notStrictEqual(bad.status, 0);

    const good = spawnSync(
      process.execPath,
      [cli, 'transition', '--goal-dir', goalDir, '--to', 'goal-discovery', '--actor', 'hypervisor', '--plugin-root', root],
      { encoding: 'utf8' }
    );
    assert.strictEqual(good.status, 0, good.stderr);
  });
});
