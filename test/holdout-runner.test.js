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
  resolvePackCommit,
} = require('../scripts/lib/bench/holdout-runner.cjs');
const { applyFixtureSolution } = require('../scripts/lib/bench/fixture-solutions.cjs');
const { compareScorecards } = require('../scripts/bench/compare.cjs');
const { buildHonestyReport } = require('../scripts/lib/bench/honesty-report.cjs');

/**
 * Tiny clean git checkout for pack_commit stamping (isolates from dirty worktrees).
 * @returns {{ dir: string, head: string }}
 */
function makeCleanPackGit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae034c-pack-'));
  const run = (args) => {
    const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return r;
  };
  run(['init']);
  run(['config', 'user.name', 'Holdout Fixture']);
  run(['config', 'user.email', 'holdout@example.com']);
  fs.writeFileSync(path.join(dir, 'PACK'), 'holdout-pack\n');
  run(['add', 'PACK']);
  run(['commit', '-m', 'pack tip']);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: dir,
    encoding: 'utf8',
  });
  assert.equal(head.status, 0);
  return { dir, head: String(head.stdout).trim() };
}

describe('AE-034c holdout runner + honesty report', () => {
  it('fixture adapter: ≥1 task reaches validation and independent score delivers', async () => {
    const evalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ae034c-run-'));
    const pack = makeCleanPackGit();
    const out = path.join(evalRoot, 'holdout-fixture-run.json');
    const result = await runHoldoutSuite({
      repoRoot: root,
      packRoot: pack.dir,
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
    assert.equal(result.report.pack_commit, pack.head);
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
    const pack = makeCleanPackGit();
    const out = path.join(evalRoot, 'holdout-baseline.json');
    const result = await runHoldoutSuite({
      repoRoot: root,
      packRoot: pack.dir,
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
      // Commit first so E8-cited dirty check against the live pack can pass when
      // this suite is run mid-edit; CI checkouts are already clean.
      const dirty = spawnSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
      });
      const cliArgs = [
        path.join(root, 'scripts/bench/run-holdout.cjs'),
        '--provider',
        'fixture',
        '--out',
        out,
      ];
      // When the worktree is dirty (local mid-edit), point packRoot at a clean tip.
      let env = { ...process.env, AE_HOLDOUT_HOSTED: '0' };
      let pack;
      if (String(dirty.stdout || '').trim()) {
        pack = makeCleanPackGit();
        cliArgs.push('--pack-root', pack.dir);
      }
      const cli = spawnSync(process.execPath, cliArgs, {
        cwd: root,
        encoding: 'utf8',
        env,
      });
      assert.equal(cli.status, 0, cli.stderr || cli.stdout);
      assert.ok(fs.existsSync(out));
      const report = JSON.parse(fs.readFileSync(out, 'utf8'));
      if (pack) {
        assert.equal(report.pack_commit, pack.head);
      } else {
        const head = spawnSync('git', ['rev-parse', 'HEAD'], {
          cwd: root,
          encoding: 'utf8',
        });
        assert.equal(report.pack_commit, String(head.stdout).trim());
      }
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

  it('recorded pack_commit equals git rev-parse HEAD in a temp git repo fixture', async () => {
    const pack = makeCleanPackGit();
    assert.equal(resolvePackCommit(pack.dir, { e8Cited: true }), pack.head);

    const evalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ae034c-pack-eq-'));
    const out = path.join(evalRoot, 'holdout-pack-eq.json');
    const result = await runHoldoutSuite({
      repoRoot: root,
      packRoot: pack.dir,
      evalRoot,
      out,
      provider: 'fixture',
      e8Cited: true,
      stamp: 'pack-eq',
    });
    assert.equal(result.ok, true);
    assert.equal(result.report.pack_commit, pack.head);
    assert.match(result.report.pack_commit, /^[0-9a-f]{40}$/i);
    // Manifest may still carry a short historical pin; honesty uses live HEAD.
    assert.notEqual(result.report.pack_commit, result.report.manifest_pack_commit);
  });

  it('dirty tree on an E8-cited cold run is refused', () => {
    const pack = makeCleanPackGit();
    fs.writeFileSync(path.join(pack.dir, 'DIRTY'), 'uncommitted\n');
    assert.throws(
      () => resolvePackCommit(pack.dir, { e8Cited: true, coldRun: true }),
      (err) => err && err.code === 'PACK_COMMIT_DIRTY_TREE'
    );
    // Non-E8 path still resolves HEAD (audit optional field).
    assert.equal(
      resolvePackCommit(pack.dir, { e8Cited: false, coldRun: true }),
      pack.head
    );
  });

  it('missing git HEAD fails closed with PACK_COMMIT_UNDETERMINED', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae034c-nogit-'));
    assert.throws(
      () => resolvePackCommit(dir, { e8Cited: true }),
      (err) => err && err.code === 'PACK_COMMIT_UNDETERMINED'
    );
  });
});
