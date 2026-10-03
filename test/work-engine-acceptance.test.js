'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('os');
const path = require('node:path');
const { applyTransition } = require('../scripts/lib/work-engine/engine.cjs');
const { legacyScoreWorklog } = require('../scripts/lib/bench/score-worklog.cjs');

const pluginRoot = path.join(__dirname, '..');
const cli = path.join(pluginRoot, 'scripts', 'work-engine.cjs');
const bin = path.join(pluginRoot, 'bin', 'agentic-swe.cjs');

function workItem(dir, command) {
  const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
  tpl.work_id = 'gate';
  tpl.task = 'gate';
  tpl.current_state = 'validation';
  tpl.pipeline.track = 'lean';
  tpl.pipeline.acceptance_command = command;
  tpl.budget.budget_remaining = 5;
  tpl.budget.cost_used = 0;
  tpl.history = [{ at: '2026-01-01T00:00:00.000Z', actor: 'test', from: 'lean-track-implementation', to: 'validation' }];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(tpl, null, 2));
  fs.writeFileSync(path.join(dir, 'validation-results.md'), '# validation\napproved\n');
}

describe('acceptance gate on validation → pr-creation', () => {
  it('refuses a non-zero acceptance command and does not advance state', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-acc-'));
    const workDir = path.join(root, '.worklogs', 'gate');
    workItem(workDir, 'node -e "process.exit(1)"');
    const r = applyTransition({
      workDir,
      pluginRoot,
      to: 'pr-creation',
      actor: 'test',
      skipMuscleMemory: true,
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'ACCEPTANCE_FAILED');
    const state = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
    assert.strictEqual(state.current_state, 'validation');
    const verify = JSON.parse(fs.readFileSync(path.join(workDir, 'verify-result.json'), 'utf8'));
    assert.strictEqual(verify.exit_code, 1);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('advances when the acceptance command exits 0', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-acc-'));
    const workDir = path.join(root, '.worklogs', 'gate');
    workItem(workDir, 'node -e "process.exit(0)"');
    const r = applyTransition({
      workDir,
      pluginRoot,
      to: 'pr-creation',
      actor: 'test',
      skipMuscleMemory: true,
    });
    assert.strictEqual(r.ok, true, r.message || JSON.stringify(r));
    assert.strictEqual(r.state.current_state, 'pr-creation');
    assert.strictEqual(r.state.metrics.tests_passed, true);
    const verify = JSON.parse(fs.readFileSync(path.join(workDir, 'verify-result.json'), 'utf8'));
    assert.strictEqual(verify.exit_code, 0);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('scores a completed work item as a fail when verify-result exited non-zero', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-acc-'));
    const workDir = path.join(root, '.worklogs', 'gate');
    workItem(workDir, 'node -e "process.exit(1)"');
    const state = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
    state.current_state = 'completed';
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(state));
    fs.writeFileSync(path.join(workDir, 'verify-result.json'), JSON.stringify({ exit_code: 1 }));
    const scores = legacyScoreWorklog(workDir);
    assert.strictEqual(scores.task_pass, 0);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('agentic-swe work', () => {
  it('init defaults a new work item to the lean track', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-lean-'));
    const r = spawnSync(process.execPath, [cli, 'init', '--id', 'new1', '--task', 'hello', '--work-root', tmp, '--json'], {
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const state = JSON.parse(fs.readFileSync(path.join(tmp, '.worklogs', 'new1', 'state.json'), 'utf8'));
    assert.strictEqual(state.pipeline.track, 'lean');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('status prints the active work block', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-stat-'));
    const init = spawnSync(process.execPath, [bin, 'work', 'init', '--id', 's1', '--task', 't', '--work-root', tmp, '--json'], {
      encoding: 'utf8',
    });
    assert.strictEqual(init.status, 0, init.stderr + init.stdout);
    const status = spawnSync(process.execPath, [bin, 'work', 'status', '--project-root', tmp], { encoding: 'utf8' });
    assert.strictEqual(status.status, 0, status.stderr + status.stdout);
    assert.match(status.stdout, /Active work: s1/);
    assert.match(status.stdout, /Track: lean/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
