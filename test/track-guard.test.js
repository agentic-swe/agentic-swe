'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { applyTransition, loadWorkItem } = require('../scripts/lib/work-engine/engine.cjs');
const { recordTrackWaiver } = require('../scripts/lib/work-engine/track-guard.cjs');

const pluginRoot = path.join(__dirname, '..');
const identity = { actor: 'user:tester@example.com', name: 'Tester', email: 'tester@example.com', os_user: 'tester' };

function workDirAt(stateName, track) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'track-guard-'));
  const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
  tpl.work_id = 'track-guard';
  tpl.task = 'test';
  tpl.pipeline.track = track;
  tpl.current_state = stateName;
  tpl.budget.budget_remaining = 30;
  tpl.budget.cost_used = 0;
  tpl.history = [];
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(tpl, null, 2));
  fs.writeFileSync(path.join(dir, 'feasibility.md'), '# feasibility\n');
  return dir;
}

function transition(dir, extra) {
  return applyTransition({
    workDir: dir,
    pluginRoot,
    to: 'lean-track-check',
    actor: 'test',
    skipMuscleMemory: true,
    ...extra,
  });
}

describe('set-pipeline-track guard', () => {
  it('rejects a track change outside lean-track-check', () => {
    const dir = workDirAt('feasibility', 'rigorous');
    const r = transition(dir, { setPipelineTrack: 'lean' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'TRACK_GUARD');
    assert.strictEqual(loadWorkItem(dir, pluginRoot).state.pipeline.track, 'rigorous');
    assert.strictEqual(loadWorkItem(dir, pluginRoot).state.current_state, 'feasibility');
  });

  it('accepts a downgrade when a user waiver is recorded, and rejects an upgrade', () => {
    const dir = workDirAt('feasibility', 'rigorous');
    const waived = recordTrackWaiver({ workDir: dir, pluginRoot, reason: 'founder asked', identity });
    assert.strictEqual(waived.ok, true, waived.message);
    const down = transition(dir, { setPipelineTrack: 'lean' });
    assert.strictEqual(down.ok, true, down.message);
    assert.strictEqual(loadWorkItem(dir, pluginRoot).state.pipeline.track, 'lean');

    const again = workDirAt('feasibility', 'lean');
    recordTrackWaiver({ workDir: again, pluginRoot, reason: 'not a downgrade', identity });
    const up = transition(again, { setPipelineTrack: 'rigorous' });
    assert.strictEqual(up.ok, false);
    assert.strictEqual(up.code, 'TRACK_GUARD');
    assert.strictEqual(loadWorkItem(again, pluginRoot).state.pipeline.track, 'lean');
  });

  it('ignores a waiver whose actor is not a user', () => {
    const dir = workDirAt('feasibility', 'standard');
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    st.pipeline.track_waiver = { actor: 'agent:hypervisor', reason: 'skip', at: '2026-01-01T00:00:00.000Z' };
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(st));
    const r = transition(dir, { setPipelineTrack: 'lean' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'TRACK_GUARD');
  });

  it('CLI waive-track refuses an agent session', () => {
    const dir = workDirAt('feasibility', 'rigorous');
    const r = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts', 'work-engine.cjs'), 'waive-track', '--work-dir', dir, '--reason', 'no', '--json'],
      { encoding: 'utf8', env: { ...process.env, CURSOR_AGENT: '1' } }
    );
    assert.notStrictEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.code, 'AGENT_CONTEXT');
    assert.strictEqual(loadWorkItem(dir, pluginRoot).state.pipeline.track_waiver, undefined);
  });
});
