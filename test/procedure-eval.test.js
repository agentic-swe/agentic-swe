'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { evalProcedureVerify, isolatedVerifyRel } = require('../scripts/lib/descent/procedure-eval.cjs');
const { tryDescentLadder } = require('../scripts/lib/descent/ladder.cjs');
const { promoteOrDemote, DEFAULT_STORE } = require('../scripts/lib/descent/promotion.cjs');
const { applyTransition } = require('../scripts/lib/work-engine/engine.cjs');
const { aggregateProductionTierTotals } = require('../scripts/lib/bench/production-tier-totals.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('procedure-eval', () => {
  it('passes isolated node test command', () => {
    const cwd = path.join(pluginRoot, 'bench/corpus/mined-trivial-pass/repo');
    const r = evalProcedureVerify({
      procedure: { verify: [{ type: 'RUN', command: 'npm test', cwd }] },
      projectRoot: cwd,
    });
    assert.equal(r.ok, true);
  });

  it('fails missing verify action', () => {
    const r = evalProcedureVerify({ procedure: {}, projectRoot: pluginRoot });
    assert.equal(r.ok, false);
  });

  it('detects isolated node --test files', () => {
    const rel = 'test/procedure-eval.test.js';
    assert.equal(isolatedVerifyRel(`node --test ${rel}`, pluginRoot), rel);
    assert.equal(isolatedVerifyRel('npm test', pluginRoot), null);
  });
});

describe('unevaluated procedures are not replayed', () => {
  it('skips unevaluated L1 records', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uneval-'));
    fs.mkdirSync(path.join(tmp, '.agentic-swe'), { recursive: true });
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: 'abc',
      procedure: {
        verify: [{ type: 'RUN', command: 'npm test', cwd: path.join(pluginRoot, 'bench/corpus/mined-trivial-pass/repo') }],
        _meta: { source: 'session-mine' },
      },
      evalPassed: false,
      humanApproved: false,
    });
    const store = JSON.parse(fs.readFileSync(path.join(tmp, DEFAULT_STORE), 'utf8'));
    assert.equal(store.procedures[0].eval_status, 'unevaluated');

    const r = await tryDescentLadder({
      projectRoot: tmp,
      pluginRoot,
      verifyCommand: 'npm test',
      files: ['session-x'],
      cwd: path.join(pluginRoot, 'bench/corpus/mined-trivial-pass/repo'),
    });
    assert.equal(r.ok, false);
    assert.equal(r.tier, 'L3');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('validation transition records live tier_totals', () => {
  it('applyTransition validation→pr-creation records descent metrics', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'val-desc-'));
    const workDir = path.join(tmp, '.worklogs', 'w-live');
    fs.mkdirSync(workDir, { recursive: true });
    const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
    const now = new Date().toISOString();
    tpl.work_id = 'w-live';
    tpl.task = 'live path';
    tpl.current_state = 'validation';
    tpl.created_at = now;
    tpl.updated_at = now;
    tpl.timeout_at = now;
    tpl.pipeline.track = 'lean';
    tpl.metrics.verify_command = 'npm test';
    tpl.metrics.tests_passed = true;
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(tpl, null, 2));
    fs.writeFileSync(
      path.join(workDir, 'validation-results.md'),
      '# Validation\n\nclassification: `approved`\n\n```bash\nnpm test\n```\n',
      'utf8'
    );
    fs.writeFileSync(path.join(workDir, 'implementation.md'), '# Implementation\n', 'utf8');

    const r = applyTransition({
      workDir,
      pluginRoot,
      from: 'validation',
      to: 'pr-creation',
      actor: 'test',
      procedureStoreRoot: tmp,
    });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.state.current_state, 'pr-creation');
    assert.ok(r.state.metrics.descent_recorded_at, 'expected descent_recorded_at');
    assert.ok(r.state.budget.tier_totals);

    const live = aggregateProductionTierTotals(tmp, { includeFixtures: false });
    assert.equal(live.work_items, 1);
    assert.equal(live.sources.live, 1);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
