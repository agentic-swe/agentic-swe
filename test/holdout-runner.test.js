'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const {
  runHoldoutSuite,
  scoreHoldoutIndependently,
  writeLeanWorklog,
  plantRegressionScorecard,
  copyDir,
} = require('../scripts/lib/bench/holdout-runner.cjs');
const { applyFixtureSolution } = require('../scripts/lib/bench/fixture-solutions.cjs');
const { compareScorecards } = require('../scripts/bench/compare.cjs');
const { buildHonestyReport } = require('../scripts/lib/bench/honesty-report.cjs');

describe('AE-034c holdout runner + honesty report', () => {
  it('fixture adapter: ≥1 task reaches validation and independent score delivers', async () => {
    const evalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ae034c-run-'));
    const out = path.join(evalRoot, 'holdout-fixture-run.json');
    const result = await runHoldoutSuite({
      repoRoot: root,
      evalRoot,
      out,
      provider: 'fixture',
      e8Cited: true,
      stamp: 'fixture-run',
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors || result.report?.summary));
    assert.ok(result.reachedValidation >= 1, 'need ≥1 task at validation');
    assert.ok(result.report.summary.delivered >= 1, 'need ≥1 delivered via oracle/acceptance');
    assert.equal(result.report.model_provenance.sole_e8_proof, false);
    assert.equal(result.report.model_provenance.not_sole_e8_proof, true);
    assert.ok(Array.isArray(result.report.retained_negatives));
    assert.ok(result.report.limitations.length >= 1);
    assert.ok(fs.existsSync(out));
    assert.ok(path.basename(out).startsWith('holdout-'));
    // No L0 contamination asserted inside runner; procedures file empty/wiped.
    const proc = path.join(evalRoot, '.agentic-swe', 'procedures.json');
    if (fs.existsSync(proc)) {
      assert.deepEqual(JSON.parse(fs.readFileSync(proc, 'utf8')).procedures, []);
    }
  });

  it('score is not taken from state.json alone', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae034c-indep-'));
    const taskSrc = path.join(root, 'bench', 'tasks', '01-off-by-one');
    const taskSandbox = path.join(tmp, 'task');
    copyDir(taskSrc, taskSandbox);
    // Leave bug in place — do NOT apply fixture solution.
    const workDir = path.join(tmp, 'work');
    writeLeanWorklog(workDir, {
      workId: '01-off-by-one',
      implementationNote: 'Pretend done but code still broken. arr.length mentioned only in docs.',
      continuePastValidation: true,
    });
    // Force state to look fully done.
    const statePath = path.join(workDir, 'state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.current_state = 'completed';
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const scored = scoreHoldoutIndependently(workDir, taskSandbox);
    assert.equal(scored.state_says_done, true);
    assert.equal(scored.delivered, false, 'broken acceptance must not deliver');
    assert.match(scored.note, /not taken from state\.json alone/);
  });

  it('compare.cjs fails on a planted regression', async () => {
    const evalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ae034c-cmp-'));
    const out = path.join(evalRoot, 'holdout-baseline.json');
    const result = await runHoldoutSuite({
      repoRoot: root,
      evalRoot,
      out,
      provider: 'fixture',
    });
    assert.equal(result.ok, true);
    const baselinePath = result.scorecardPath;
    const planted = plantRegressionScorecard(result.scorecard);
    const plantedPath = path.join(evalRoot, 'holdout-planted.scorecard.json');
    fs.writeFileSync(plantedPath, `${JSON.stringify(planted, null, 2)}\n`);

    const cmp = compareScorecards(baselinePath, plantedPath);
    assert.equal(cmp.ok, false);
    assert.ok(cmp.regressions.length >= 1);

    const cli = spawnSync(
      process.execPath,
      [
        path.join(root, 'scripts/bench/compare.cjs'),
        '--baseline',
        baselinePath,
        '--current',
        plantedPath,
      ],
      { encoding: 'utf8' }
    );
    assert.notEqual(cli.status, 0, 'compare CLI must exit non-zero on planted regression');
  });

  it('honesty report labels local providers observed and not sole E8 proof', () => {
    assert.throws(
      () =>
        buildHonestyReport({
          provider: 'ollama',
          sole_e8_proof: true,
          tasks: [],
        }),
      /sole E8/
    );
    const report = buildHonestyReport({
      provider: 'ollama',
      tasks: [{ id: 'x', delivered: false, negative: true }],
    });
    assert.equal(report.model_provenance.label, 'observed');
    assert.equal(report.model_provenance.sole_e8_proof, false);
    assert.equal(report.retained_negatives.length, 1);
  });

  it('CLI writes holdout-* results; gitignore forbids committing them', async () => {
    const evalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ae034c-cli-'));
    const out = path.join(root, 'bench', 'results', `holdout-test-${process.pid}.json`);
    try {
      const cli = spawnSync(
        process.execPath,
        [
          path.join(root, 'scripts/bench/run-holdout.cjs'),
          '--provider',
          'fixture',
          '--out',
          out,
        ],
        { cwd: root, encoding: 'utf8', env: { ...process.env, AE_HOLDOUT_HOSTED: '0' } }
      );
      assert.equal(cli.status, 0, cli.stderr || cli.stdout);
      assert.ok(fs.existsSync(out));
      const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
      assert.match(gitignore, /bench\/results\/holdout-\*/);
      // Ensure the produced path would be ignored.
      const check = spawnSync('git', ['check-ignore', '-v', out], {
        cwd: root,
        encoding: 'utf8',
      });
      assert.equal(check.status, 0, 'holdout result must be gitignored');
    } finally {
      fs.rmSync(out, { force: true });
      fs.rmSync(out.replace(/\.json$/, '.scorecard.json'), { force: true });
      fs.rmSync(evalRoot, { recursive: true, force: true });
    }
  });

  it('fixture solution makes 01-off-by-one acceptance pass in sandbox', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae034c-sol-'));
    const taskSandbox = path.join(tmp, 'task');
    copyDir(path.join(root, 'bench', 'tasks', '01-off-by-one'), taskSandbox);
    applyFixtureSolution('01-off-by-one', taskSandbox);
    const workDir = path.join(tmp, 'work');
    writeLeanWorklog(workDir, {
      workId: '01-off-by-one',
      implementationNote: 'Fix return to use arr.length without off-by-one.',
    });
    const scored = scoreHoldoutIndependently(workDir, taskSandbox);
    assert.equal(scored.delivered, true, JSON.stringify(scored.scores));
  });
});
