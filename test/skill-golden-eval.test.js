'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runGoldenEval, loadGoldenEvalMap } = require('../scripts/lib/skills/golden-eval.cjs');

const root = path.join(__dirname, '..');

describe('golden eval harness', () => {
  it('loads skill-golden-eval map', () => {
    const map = loadGoldenEvalMap(root);
    assert.ok(Object.keys(map).length >= 10);
    assert.ok(map.check);
  });

  it('check skill passes oracle-verify-sanity', () => {
    const r = runGoldenEval({ pluginRoot: root, skillName: 'check' });
    assert.strictEqual(r.ok, true, r.stderr || r.error);
    assert.match(r.eval_ref, /oracle-verify-sanity/);
  });

  it('skill-eval run --all exits 0 after promotion', () => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/skill-eval.cjs'), 'run', '--all'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  });

  it('evaluated skills pass autonomous gate', () => {
    const { checkSkillEvalGate } = require('../scripts/lib/skills/eval-gate.cjs');
    const gate = checkSkillEvalGate({ pluginRoot: root, skillName: 'check', autonomous: true });
    assert.strictEqual(gate.allowed, true, gate.reason);
    assert.strictEqual(gate.eval_status, 'evaluated');
  });
});

describe('token scorecard CLI', () => {
  it('writes token-reduction scorecard', () => {
    const out = path.join(root, 'bench', 'results', 'token-reduction-test.json');
    const r = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/bench/token-scorecard.cjs'), '--out', out],
      { cwd: root, encoding: 'utf8' }
    );
    assert.strictEqual(r.status, 0, r.stderr);
    const data = require(out);
    assert.ok(data.fixed_overhead.reduction_ratio > 0.5);
    assert.ok(data.skills.evaluated >= 10);
    assert.ok('organic_portfolio' in data.warm_portfolio_projection);
  });
});

describe('model conformance', () => {
  it('passes for current agent catalog', () => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/model-conformance.cjs')], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  });
});
