'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'scripts', 'work-engine.cjs');

describe('work-engine CLI', () => {
  it('init creates work dir and valid state.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-cli-'));
    try {
      const r = spawnSync(process.execPath, [cli, 'init', '--id', 'x1', '--task', 'hello', '--work-root', tmp, '--json'], {
        encoding: 'utf8',
        cwd: root,
      });
      assert.strictEqual(r.status, 0, r.stderr + r.stdout);
      const out = JSON.parse(r.stdout.trim());
      assert.ok(out.workDir);
      const state = JSON.parse(fs.readFileSync(path.join(out.workDir, 'state.json'), 'utf8'));
      assert.strictEqual(state.current_state, 'initialized');
      assert.strictEqual(state.work_id, 'x1');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('init --budget-profile lean sets track ceilings and policy', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-cli-'));
    try {
      const r = spawnSync(
        process.execPath,
        [cli, 'init', '--id', 'lean1', '--task', 't', '--work-root', tmp, '--budget-profile', 'lean', '--json'],
        { encoding: 'utf8', cwd: root },
      );
      assert.strictEqual(r.status, 0, r.stderr + r.stdout);
      const out = JSON.parse(r.stdout.trim());
      const state = JSON.parse(fs.readFileSync(path.join(out.workDir, 'state.json'), 'utf8'));
      assert.strictEqual(state.pipeline.track, 'lean');
      assert.strictEqual(state.budget.iteration_budget, 12);
      assert.strictEqual(state.budget.cost_budget_usd, 2.5);
      assert.strictEqual(state.budget.policy.budget_profile_track, 'lean');
      assert.ok(Number.isFinite(state.budget.policy.subagent_skip_below_budget_remaining));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('apply-budget-profile updates ceilings from work dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-cli-'));
    try {
      spawnSync(process.execPath, [cli, 'init', '--id', 'p1', '--task', 't', '--work-root', tmp], {
        encoding: 'utf8',
        cwd: root,
      });
      const wd = path.join(tmp, '.worklogs', 'p1');
      const r = spawnSync(
        process.execPath,
        [cli, 'apply-budget-profile', '--work-dir', wd, '--track', 'standard', '--json'],
        { encoding: 'utf8', cwd: root },
      );
      assert.strictEqual(r.status, 0, r.stderr + r.stdout);
      const j = JSON.parse(r.stdout.trim());
      assert.strictEqual(j.budget.iteration_budget, 10);
      assert.strictEqual(j.budget.cost_budget_usd, 6);
      const state = JSON.parse(fs.readFileSync(path.join(wd, 'state.json'), 'utf8'));
      assert.strictEqual(state.pipeline.track, 'standard');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('doctor exits 0 with no active work dir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-doc-'));
    try {
      const r = spawnSync(process.execPath, [cli, 'doctor', '--project-root', tmp, '--json'], {
        encoding: 'utf8',
        cwd: root,
      });
      assert.strictEqual(r.status, 0, r.stderr + r.stdout);
      const j = JSON.parse(r.stdout.trim());
      assert.strictEqual(j.active_non_completed_count, 0);
      assert.strictEqual(j.active_work_dir, null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('doctor exits 1 when active item budget is STOP', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-doc-b-'));
    try {
      spawnSync(process.execPath, [cli, 'init', '--id', 'd1', '--task', 't', '--work-root', tmp], {
        encoding: 'utf8',
        cwd: root,
      });
      const wd = path.join(tmp, '.worklogs', 'd1');
      const state = JSON.parse(fs.readFileSync(path.join(wd, 'state.json'), 'utf8'));
      state.budget.budget_remaining = 0;
      fs.writeFileSync(path.join(wd, 'state.json'), JSON.stringify(state, null, 2));
      const r = spawnSync(process.execPath, [cli, 'doctor', '--project-root', tmp, '--json'], {
        encoding: 'utf8',
        cwd: root,
      });
      assert.strictEqual(r.status, 1, r.stderr + r.stdout);
      const j = JSON.parse(r.stdout.trim());
      assert.strictEqual(j.ok, false);
      assert.strictEqual(j.budget_verdict.verdict, 'STOP');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('migrate delegates to migrate-work-state (dry-run)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-mig-'));
    try {
      const r = spawnSync(process.execPath, [cli, 'migrate'], { encoding: 'utf8', cwd: tmp });
      assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('budget exits 1 when exhausted', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-cli-'));
    try {
      spawnSync(process.execPath, [cli, 'init', '--id', 'b1', '--task', 't', '--work-root', tmp], {
        encoding: 'utf8',
        cwd: root,
      });
      const wd = path.join(tmp, '.worklogs', 'b1');
      const state = JSON.parse(fs.readFileSync(path.join(wd, 'state.json'), 'utf8'));
      state.budget.budget_remaining = 0;
      fs.writeFileSync(path.join(wd, 'state.json'), JSON.stringify(state, null, 2));
      const r = spawnSync(process.execPath, [cli, 'budget', '--work-dir', wd, '--json'], {
        encoding: 'utf8',
        cwd: root,
      });
      assert.strictEqual(r.status, 1);
      const j = JSON.parse(r.stdout.trim());
      assert.strictEqual(j.verdict, 'STOP');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
