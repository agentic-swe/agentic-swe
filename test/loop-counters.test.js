'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { decideTransition } = require('../scripts/lib/work-engine/decide.cjs');
const {
  applyTransition,
  loadWorkItem,
  recordSpawn,
  validateTransition,
  validateWorkDir,
} = require('../scripts/lib/work-engine/engine.cjs');
const { recomputeCounters, rejectionCounter } = require('../scripts/lib/work-engine/counters.cjs');

const pluginRoot = path.join(__dirname, '..');

function workItem(track, stateName) {
  const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
  tpl.work_id = 'loop-counters';
  tpl.task = 'test';
  tpl.pipeline.track = track;
  tpl.current_state = stateName;
  tpl.budget.budget_remaining = 30;
  tpl.budget.cost_used = 0;
  tpl.history = [];
  return tpl;
}

describe('rejection counter map', () => {
  it('maps each rejection edge, with lean validation consuming lean_iter', () => {
    assert.strictEqual(rejectionCounter('self-review', 'implementation'), 'self_review_iter');
    assert.strictEqual(rejectionCounter('code-review', 'implementation'), 'code_iter');
    assert.strictEqual(rejectionCounter('validation', 'implementation', 'rigorous'), 'code_iter');
    assert.strictEqual(rejectionCounter('validation', 'implementation', 'lean'), 'lean_iter');
    assert.strictEqual(rejectionCounter('design-review', 'design'), 'design_iter');
    assert.strictEqual(rejectionCounter('verification', 'design'), 'design_iter');
    assert.strictEqual(rejectionCounter('approval-wait', 'implementation'), 'approval_iter');
    assert.strictEqual(rejectionCounter('implementation', 'self-review'), null);
  });

  it('increments on the transition and can be replayed from history', () => {
    const state = workItem('rigorous', 'self-review');
    const { next } = decideTransition({
      state,
      from: 'self-review',
      to: 'implementation',
      now: '2026-01-01T00:00:00.000Z',
      actor: 'test',
    });
    assert.strictEqual(next.counters.self_review_iter, 1);
    assert.strictEqual(state.counters.self_review_iter, 0);
    assert.deepStrictEqual(recomputeCounters(next.history), {
      lean_iter: 0,
      design_iter: 0,
      code_iter: 0,
      self_review_iter: 1,
      approval_iter: 0,
      panel_runs: 0,
      subagent_spawns: 0,
    });
  });

  it('leaves approval_iter for work approve', () => {
    const state = workItem('rigorous', 'approval-wait');
    const { next } = decideTransition({
      state,
      from: 'approval-wait',
      to: 'implementation',
      now: '2026-01-01T00:00:00.000Z',
    });
    assert.strictEqual(next.counters.approval_iter, 0);
    assert.strictEqual(next.history[0].counter, 'approval_iter');
  });
});

describe('code_iter cap', () => {
  it('stops the sixth code-review → implementation at plan time', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-counters-'));
    const workDir = path.join(tmp, '.worklogs', 'loop-counters');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(workItem('rigorous', 'code-review'), null, 2));
    fs.writeFileSync(path.join(workDir, 'review-pass.md'), '# pass\n');
    fs.writeFileSync(path.join(workDir, 'implementation.md'), '# impl\n');
    fs.writeFileSync(path.join(workDir, 'self-review.md'), '# review\n');

    for (let i = 0; i < 5; i++) {
      const rejected = applyTransition({
        workDir,
        pluginRoot,
        to: 'implementation',
        actor: 'test',
        skipMuscleMemory: true,
      });
      assert.strictEqual(rejected.ok, true, rejected.message || JSON.stringify(rejected));
      if (i === 4) break;
      const back = applyTransition({ workDir, pluginRoot, to: 'self-review', actor: 'test', skipMuscleMemory: true });
      assert.strictEqual(back.ok, true, back.message || JSON.stringify(back));
      const again = applyTransition({ workDir, pluginRoot, to: 'code-review', actor: 'test', skipMuscleMemory: true });
      assert.strictEqual(again.ok, true, again.message || JSON.stringify(again));
    }

    const loaded = loadWorkItem(workDir, pluginRoot);
    assert.strictEqual(loaded.state.counters.code_iter, 5);
    const planned = validateTransition({
      workDir,
      pluginRoot,
      state: loaded.state,
      from: 'code-review',
      to: 'implementation',
    });
    assert.strictEqual(planned.ok, false);
    assert.strictEqual(planned.code, 'BUDGET_STOP');
    assert.match(planned.message, /code_iter/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('counter integrity and spawns', () => {
  it('validate reports COUNTER_MISMATCH when a stored counter disagrees with history', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-mismatch-'));
    const workDir = path.join(tmp, '.worklogs', 'loop-counters');
    fs.mkdirSync(workDir, { recursive: true });
    const state = workItem('rigorous', 'implementation');
    state.counters.code_iter = 4;
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(state, null, 2));
    const r = validateWorkDir(workDir, pluginRoot);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'COUNTER_MISMATCH');
    assert.match(r.message, /code_iter=4 but history implies 0/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('record-spawn is the only writer and keeps validate consistent', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-spawn-'));
    const workDir = path.join(tmp, '.worklogs', 'loop-counters');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(workItem('lean', 'implementation'), null, 2));

    const spawned = recordSpawn({ workDir, pluginRoot, role: 'developer-agent', actor: 'test' });
    assert.strictEqual(spawned.ok, true, spawned.message);
    assert.strictEqual(spawned.state.counters.subagent_spawns, 1);
    const panel = recordSpawn({ workDir, pluginRoot, role: 'panel:design', actor: 'test' });
    assert.strictEqual(panel.state.counters.panel_runs, 1);
    assert.strictEqual(panel.state.current_state, 'implementation');
    assert.strictEqual(validateWorkDir(workDir, pluginRoot).ok, true);

    const cli = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts', 'work-engine.cjs'), 'record-spawn', '--work-dir', workDir, '--role', 'qa-expert', '--json'],
      { encoding: 'utf8' }
    );
    assert.strictEqual(cli.status, 0, cli.stderr);
    assert.strictEqual(JSON.parse(cli.stdout).subagent_spawns, 2);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
