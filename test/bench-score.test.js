'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { scoreWorklog } = require('../scripts/lib/bench/score-worklog.cjs');
const { runTaskAcceptance } = require('../scripts/lib/bench/run-task.cjs');

const TASKS_ROOT = path.resolve(__dirname, '../bench/tasks');
const TASK_01 = path.join(TASKS_ROOT, '01-off-by-one');

function makeWorkDir(stateOverrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-score-'));
  const state = {
    schema_version: 2,
    work_id: 'bench-test',
    task: 'test',
    current_state: 'completed',
    budget: { cost_used: 0.5, cost_budget_usd: 3, budget_remaining: 5, iteration_budget: 10 },
    pipeline: { track: 'lean' },
    history: [
      { from: 'initialized', to: 'lean-track-check' },
      { from: 'lean-track-check', to: 'lean-track-implementation' },
      { from: 'lean-track-implementation', to: 'validation' },
      { from: 'validation', to: 'completed' },
    ],
    ...stateOverrides,
  };
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2));
  fs.writeFileSync(
    path.join(dir, 'implementation.md'),
    'Fix return to use arr.length without off-by-one.',
  );
  return dir;
}

test('scoreWorklog runs acceptance tests when scoring.json specifies run_acceptance_tests', () => {
  const workDir = makeWorkDir({ current_state: 'implementation' });
  const scores = scoreWorklog(workDir, TASK_01);
  assert.equal(typeof scores.task_pass, 'number');
  assert.ok('details' in scores);
  assert.ok(scores.task_pass >= 0 && scores.task_pass <= 1);
});

test('completed worklog with failing acceptance does not score task_pass 1.0 when tests fail', () => {
  const workDir = makeWorkDir({ current_state: 'completed' });
  const scores = scoreWorklog(workDir, TASK_01);
  const acceptance = runTaskAcceptance(TASK_01);
  if (!acceptance.ok) {
    assert.ok(scores.task_pass < 1.0, 'task_pass should reflect failing acceptance');
  }
});

test('legacy scoreWorklog without taskDir uses proxy scoring', () => {
  const workDir = makeWorkDir();
  const scores = scoreWorklog(workDir);
  assert.equal(scores.task_pass, 1.0);
});

test('bench run acceptance fails on unfixed starter task (intentional bug)', () => {
  const run = runTaskAcceptance(TASK_01);
  assert.equal(run.ok, false, 'starter task repo should fail until agent fixes bug');
});

test('bench CLI run subcommand writes results file', () => {
  const out = path.join(os.tmpdir(), `bench-run-${Date.now()}.json`);
  const runner = path.resolve(__dirname, '../scripts/bench/run.cjs');
  const result = spawnSync(process.execPath, [runner, 'run', '--out', out], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(fs.existsSync(out));
  const scorecard = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(scorecard.tasks.length >= 3);
  fs.unlinkSync(out);
});
