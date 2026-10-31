'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scoreWorklog } = require('../scripts/lib/bench/score-worklog.cjs');
const { scoreTaskDirect } = require('../scripts/lib/bench/run-task.cjs');
const { checkSkillEvalGate } = require('../scripts/lib/skills/eval-gate.cjs');
const { promotedEvalStatus, LINT_ONLY_EVAL_REFS } = require('../scripts/lib/skills/golden-eval.cjs');
const { estimated, PROVENANCE } = require('../scripts/lib/bench/provenance.cjs');

const root = path.join(__dirname, '..');
const PASS_THRESHOLD = 0.6;
const TASK_01 = path.join(root, 'bench', 'tasks', '01-off-by-one');

function untouchedWorkDir(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-untouched-'));
  fs.writeFileSync(
    path.join(dir, 'state.json'),
    JSON.stringify({ work_id: 'u', current_state: 'initialized', history: [], budget: { cost_budget_usd: 3 }, ...extra })
  );
  return dir;
}

describe('dimensions without evidence score 0', () => {
  it('an untouched task scores below the pass threshold with scoring.json', () => {
    const dir = untouchedWorkDir();
    try {
      const s = scoreWorklog(dir, TASK_01);
      assert.equal(s.cost_efficiency, 0, s.details.cost_efficiency);
      assert.equal(s.cross_model, 0, s.details.cross_model);
      assert.equal(s.gate_respect, 0, s.details.gate_respect);
      assert.ok(s.total < PASS_THRESHOLD, `total ${s.total}`);
      assert.equal(s.total, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an untouched task scores 0 under legacy proxy scoring', () => {
    const dir = untouchedWorkDir();
    try {
      const s = scoreWorklog(dir);
      assert.deepEqual([s.task_pass, s.cost_efficiency, s.cross_model, s.gate_respect, s.total], [0, 0, 0, 0, 0]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cost efficiency needs a recorded cost as well as transitions', () => {
    const dir = untouchedWorkDir({ history: [{ from: 'initialized', to: 'feasibility' }], budget: {} });
    try {
      const s = scoreWorklog(dir, TASK_01);
      assert.equal(s.cost_efficiency, 0);
      assert.match(s.details.cost_efficiency, /cost_used not recorded/);
      assert.ok(s.gate_respect > 0, 'transitions are gate evidence');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('direct task scoring credits only the acceptance run', () => {
    const s = scoreTaskDirect(path.join(root, 'bench', 'corpus', 'mined-trivial-pass'));
    assert.equal(s.task_pass, 1);
    assert.equal(s.total, 0.4);
    assert.deepEqual(s.unscored, ['cost_efficiency', 'cross_model', 'gate_respect']);
    assert.ok(s.total < PASS_THRESHOLD);
  });

  it('committed corpus scoring carries no default_score credit', () => {
    for (const d of fs.readdirSync(path.join(root, 'bench', 'corpus'))) {
      const f = path.join(root, 'bench', 'corpus', d, 'scoring.json');
      if (fs.existsSync(f)) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /default_score/, f);
    }
  });
});

describe('lint-only skill evals', () => {
  it('catalog lint earns lint_passed, other oracles earn evaluated', () => {
    assert.equal(promotedEvalStatus('bench/corpus/oracle-catalog-lint'), 'lint_passed');
    assert.equal(promotedEvalStatus('bench/corpus/oracle-state-machine'), 'evaluated');
  });

  it('no shipped skill claims evaluated on a lint-only eval_ref', () => {
    let lintPassed = 0;
    for (const d of fs.readdirSync(path.join(root, 'skills'))) {
      const f = path.join(root, 'skills', d, 'SKILL.md');
      if (!fs.existsSync(f)) continue;
      const raw = fs.readFileSync(f, 'utf8');
      const ref = /eval_ref: "([^"]*)"/.exec(raw)?.[1];
      const status = /eval_status: "([^"]*)"/.exec(raw)?.[1];
      if (LINT_ONLY_EVAL_REFS.has(ref)) {
        assert.equal(status, 'lint_passed', d);
        lintPassed++;
      }
    }
    assert.ok(lintPassed > 0);
  });

  it('eval-gate treats lint_passed as manual-only', () => {
    const plugin = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-gate-'));
    try {
      fs.mkdirSync(path.join(plugin, 'skills', 's'), { recursive: true });
      fs.writeFileSync(
        path.join(plugin, 'skills', 's', 'SKILL.md'),
        '---\nname: s\ndescription: "d"\nmetadata:\n  eval_status: "lint_passed"\n  eval_ref: "bench/corpus/oracle-catalog-lint"\n---\nbody\n'
      );
      const auto = checkSkillEvalGate({ pluginRoot: plugin, skillName: 's', autonomous: true });
      assert.equal(auto.allowed, false);
      assert.match(auto.reason, /eval_status=lint_passed/);
      assert.equal(checkSkillEvalGate({ pluginRoot: plugin, skillName: 's', autonomous: false }).allowed, true);
    } finally {
      fs.rmSync(plugin, { recursive: true, force: true });
    }
  });
});

describe('constant-derived results are estimated', () => {
  it('estimated() never yields measured', () => {
    assert.deepEqual(estimated(['x']), { provenance: PROVENANCE.ESTIMATED, provenance_basis: ['x'] });
  });

  it('every bench that uses the policy-token constants labels its output estimated', () => {
    for (const rel of ['token-scorecard.cjs', 'warm-cold.cjs', 'run-portfolio.cjs', 'run-production-evidence.cjs', 'run-organic-portfolio.cjs']) {
      const src = fs.readFileSync(path.join(root, 'scripts', 'bench', rel), 'utf8');
      assert.match(src, /\.\.\.estimated\(\[/, `${rel} must spread estimated(...) into its JSON output`);
      assert.doesNotMatch(src, /7700|1750/, `${rel} must take policy-token constants from provenance.cjs`);
    }
  });

  it('warm-cold writes provenance estimated', () => {
    const out = path.join(os.tmpdir(), `warm-cold-${process.pid}.json`);
    try {
      const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'bench', 'warm-cold.cjs'), '--out', out], { cwd: root, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const j = JSON.parse(fs.readFileSync(out, 'utf8'));
      assert.equal(j.provenance, 'estimated');
      assert.ok(j.provenance_basis.length >= 2);
    } finally {
      fs.rmSync(out, { force: true });
    }
  });
});

describe('build-corpus keeps committed tasks', () => {
  function sandbox() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-sandbox-'));
    fs.mkdirSync(path.join(dir, 'scripts', 'bench'), { recursive: true });
    fs.copyFileSync(path.join(root, 'scripts', 'bench', 'build-corpus.cjs'), path.join(dir, 'scripts', 'bench', 'build-corpus.cjs'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    fs.writeFileSync(path.join(dir, '.version-bump.json'), '{}');
    fs.mkdirSync(path.join(dir, 'bench', 'corpus', 'hand-added'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'bench', 'corpus', 'hand-added', 'task.json'), '{}');
    return dir;
  }
  const run = (dir, args = []) =>
    spawnSync(process.execPath, [path.join(dir, 'scripts', 'bench', 'build-corpus.cjs'), ...args], { encoding: 'utf8' });

  it('does not delete corpus directories without --regenerate', () => {
    const dir = sandbox();
    try {
      const first = run(dir);
      assert.equal(first.status, 0, first.stderr);
      assert.ok(fs.existsSync(path.join(dir, 'bench', 'corpus', 'hand-added', 'task.json')));
      assert.ok(fs.existsSync(path.join(dir, 'bench', 'corpus', 'oracle-catalog-lint', 'scoring.json')));
      const marker = path.join(dir, 'bench', 'corpus', 'oracle-catalog-lint', 'task.json');
      fs.writeFileSync(marker, '{"edited":true}');
      const second = run(dir);
      assert.equal(second.status, 0, second.stderr);
      assert.match(second.stdout, /created 0, kept \d+ existing/);
      assert.equal(fs.readFileSync(marker, 'utf8'), '{"edited":true}');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--regenerate rebuilds from scratch', () => {
    const dir = sandbox();
    try {
      const r = run(dir, ['--regenerate']);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!fs.existsSync(path.join(dir, 'bench', 'corpus', 'hand-added')));
      assert.ok(fs.existsSync(path.join(dir, 'bench', 'corpus', 'oracle-catalog-lint', 'scoring.json')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
