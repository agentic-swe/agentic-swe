'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('os');
const path = require('node:path');
const { applyTransition, loadWorkItem } = require('../scripts/lib/work-engine/engine.cjs');

const pluginRoot = path.join(__dirname, '..');

function writeFile(p, body) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
}

describe('work-engine applyTransition', () => {
  let tmp;
  let workDir;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-'));
    workDir = path.join(tmp, 'demo-work');
    fs.mkdirSync(workDir, { recursive: true });
    const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
    tpl.work_id = 'demo-work';
    tpl.task = 'test';
    tpl.pipeline.track = 'lean';
    tpl.current_state = 'initialized';
    tpl.budget.budget_remaining = 20;
    tpl.budget.cost_used = 0;
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(tpl, null, 2));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('applies initialized → feasibility without destination artifacts (bootstrap)', () => {
    const r = applyTransition({
      workDir,
      pluginRoot,
      to: 'feasibility',
      actor: 'test',
      reason: 'bootstrap',
    });
    assert.strictEqual(r.ok, true, r.message || JSON.stringify(r));
    const l = loadWorkItem(workDir, pluginRoot);
    assert.strictEqual(l.state.current_state, 'feasibility');
    assert.ok(l.state.budget.budget_remaining < 20);
  });

  it('requires feasibility.md before feasibility → lean-track-check', () => {
    const r = applyTransition({
      workDir,
      pluginRoot,
      to: 'lean-track-check',
      actor: 'test',
    });
    assert.strictEqual(r.ok, false);
    assert.match(String(r.message), /lean-track-check\.md/);
    writeFile(path.join(workDir, 'feasibility.md'), '# ok\n');
    writeFile(path.join(workDir, 'lean-track-check.md'), '# ok\n');
    const r2 = applyTransition({
      workDir,
      pluginRoot,
      to: 'lean-track-check',
      actor: 'test',
    });
    assert.strictEqual(r2.ok, true, r2.message);
  });
});
