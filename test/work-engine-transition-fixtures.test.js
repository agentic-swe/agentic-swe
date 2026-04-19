'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('os');
const { applyTransition } = require('../scripts/lib/work-engine/engine.cjs');

const pluginRoot = path.join(__dirname, '..');
const casesPath = path.join(__dirname, 'fixtures', 'work-engine', 'transition-cases.json');

describe('work-engine illegal transitions (fixtures)', () => {
  for (const c of JSON.parse(fs.readFileSync(casesPath, 'utf8')).cases) {
    it(`${c.id}: ${c.from} → ${c.to} (${c.track}) → ${c.expectCode}`, () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-tr-'));
      const workDir = path.join(tmp, 'w');
      fs.mkdirSync(workDir, { recursive: true });
      try {
        const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
        tpl.work_id = 'fixture';
        tpl.task = 'fixture';
        tpl.pipeline = tpl.pipeline || {};
        tpl.pipeline.track = c.track;
        tpl.current_state = c.from;
        tpl.budget = tpl.budget || {};
        tpl.budget.budget_remaining = 20;
        tpl.budget.cost_used = 0;
        fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(tpl, null, 2));
        if (c.from === 'lean-track-check') {
          fs.writeFileSync(path.join(workDir, 'feasibility.md'), '# ok\n');
          fs.writeFileSync(path.join(workDir, 'lean-track-check.md'), '# ok\n');
        }
        const r = applyTransition({ workDir, pluginRoot, to: c.to, actor: 'fixture' });
        assert.strictEqual(r.ok, false, r.message || JSON.stringify(r));
        assert.strictEqual(r.code, c.expectCode, r.message || JSON.stringify(r));
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  }
});
