'use strict';

/**
 * AE-034c holdout runner core (ADR-013, PD-41/42/43, C4).
 * Service-layer: no hosted-runtime / model-gateway requires (ADR-016).
 * CLI may inject an optional agent runner; default fixture path applies solutions.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  prepareColdHoldoutRun,
  loadHiddenOracle,
  assertNoL0ForHoldout,
  verifyTaskContentPin,
  hashTaskContent,
} = require('./holdout-packaging.cjs');
const { applyFixtureSolution, hasFixtureSolution } = require('./fixture-solutions.cjs');
const { scoreWorklog } = require('./score-worklog.cjs');
const { buildHonestyReport } = require('./honesty-report.cjs');
const {
  computeManifestDigest,
  validateEvalManifestFile,
} = require('./eval-manifest.cjs');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name === '.git') continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function writeLeanWorklog(workDir, opts) {
  const now = new Date().toISOString();
  const history = [
    { from: 'initialized', to: 'feasibility', at: now },
    { from: 'feasibility', to: 'lean-track-check', at: now },
    { from: 'lean-track-check', to: 'lean-track-implementation', at: now },
    { from: 'lean-track-implementation', to: 'validation', at: now },
  ];
  if (opts.continuePastValidation) {
    history.push(
      { from: 'validation', to: 'pr-creation', at: now },
      { from: 'pr-creation', to: 'approval-wait', at: now }
    );
  }
  const state = {
    schema_version: 2,
    work_id: opts.workId,
    task: opts.taskTitle || opts.workId,
    current_state: opts.continuePastValidation ? 'approval-wait' : 'validation',
    created_at: now,
    updated_at: now,
    pipeline: { track: 'lean' },
    budget: {
      cost_used: 0,
      cost_budget_usd: 3,
      budget_remaining: 9,
      iteration_budget: 10,
      usage_totals: { input_tokens: 0, output_tokens: 0 },
      tier_totals: {},
    },
    history,
    counters: {},
  };
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(path.join(workDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  fs.writeFileSync(
    path.join(workDir, 'feasibility.md'),
    `# feasibility\nHoldout task ${opts.workId} (fixture adapter).\n`
  );
  fs.writeFileSync(
    path.join(workDir, 'lean-track-check.md'),
    `# lean-track-check\nLean track selected for ${opts.workId}.\n`
  );
  fs.writeFileSync(
    path.join(workDir, 'implementation.md'),
    `# implementation\n${opts.implementationNote || 'Fixture adapter applied deterministic fix.'}\n`
  );
  fs.writeFileSync(
    path.join(workDir, 'review-pass.md'),
    `# review-pass\nFixture self-review pass for ${opts.workId}.\n`
  );
  fs.writeFileSync(
    path.join(workDir, 'validation-results.md'),
    `# validation-results\nReached validation via fixture holdout runner.\n`
  );
  fs.writeFileSync(
    path.join(workDir, 'design-panel-review.md'),
    `# design-panel-review\nLean track partial credit artifact.\n`
  );
  return state;
}

/**
 * Independent score: hidden oracle (score phase) + acceptance + scoreWorklog.
 * Must not treat state.json current_state alone as delivery.
 */
function scoreHoldoutIndependently(workDir, taskSandboxDir) {
  const oracle = loadHiddenOracle(taskSandboxDir, { phase: 'score' });
  const scores = scoreWorklog(workDir, taskSandboxDir);
  const state = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
  const stateSaysDone = [
    'completed',
    'approval-wait',
    'validation',
    'pr-creation',
  ].includes(state.current_state);
  const acceptancePass = scores.acceptance_pass === true || scores.task_pass >= 1.0;
  const delivered = acceptancePass === true;
  return {
    oracle_method: oracle.task_pass?.method || null,
    scores,
    state_current_state: state.current_state,
    state_says_done: stateSaysDone,
    delivered,
    independent: true,
    note:
      stateSaysDone && !acceptancePass
        ? 'state looked done but acceptance/oracle failed — score not taken from state.json alone'
        : 'scored via hidden oracle + acceptance',
  };
}

function defaultResultsPath(repoRoot, stamp) {
  const dir = path.join(repoRoot, 'bench', 'results');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `holdout-${stamp}.json`);
}

function reachedValidationState(state) {
  return [
    'validation',
    'pr-creation',
    'approval-wait',
    'completed',
  ].includes(state.current_state);
}

/**
 * Run public holdout suite (fixture default).
 * @param {object} opts
 */
async function runHoldoutSuite(opts = {}) {
  const repoRoot = path.resolve(opts.repoRoot || process.cwd());
  const manifestRel = opts.manifest || 'bench/manifests/public-holdout.json';
  const manifestPath = path.resolve(repoRoot, manifestRel);
  const provider = opts.provider || 'fixture';
  const e8Cited = opts.e8Cited !== false;
  const stamp =
    opts.stamp ||
    new Date().toISOString().replace(/[:.]/g, '-');

  const evalRoot = path.resolve(
    opts.evalRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'holdout-eval-'))
  );
  fs.mkdirSync(evalRoot, { recursive: true });

  const loaded = validateEvalManifestFile(manifestPath, { repoRoot });
  if (!loaded.ok) {
    return { ok: false, code: loaded.code || 'MANIFEST_INVALID', errors: loaded.errors };
  }
  const manifest = loaded.manifest;

  const holdoutIds = (manifest.tasks || []).map((t) => t.id);
  prepareColdHoldoutRun({
    projectRoot: evalRoot,
    holdoutIds,
    e8Cited,
  });

  const taskResults = [];

  for (const task of manifest.tasks || []) {
    const pin = verifyTaskContentPin(task, repoRoot);
    if (!pin.ok) {
      taskResults.push({
        id: task.id,
        delivered: false,
        negative: true,
        negative_reason: (pin.errors || []).join('; '),
        scores: null,
        reached_validation: false,
      });
      continue;
    }

    const srcTask = path.join(repoRoot, task.path);
    const taskSandbox = path.join(evalRoot, 'tasks', task.id);
    copyDir(srcTask, taskSandbox);
    const workDir = path.join(evalRoot, '.worklogs', task.id);

    let implementationNote = `Holdout ${task.id}`;
    const agentMeta = {
      provider,
      applied_fixture_solution: false,
      adapter: provider === 'fixture' ? 'fixture' : provider,
    };

    if (typeof opts.runAgent === 'function') {
      const meta = await opts.runAgent({
        workDir,
        taskSandbox,
        task,
        provider,
        pluginRoot: repoRoot,
        evalRoot,
      });
      Object.assign(agentMeta, meta || {});
    } else if (provider === 'fixture' && hasFixtureSolution(task.id)) {
      const applied = applyFixtureSolution(task.id, taskSandbox);
      implementationNote = applied.implementationNote;
      agentMeta.applied_fixture_solution = true;
      writeLeanWorklog(workDir, {
        workId: task.id,
        taskTitle: task.id,
        implementationNote,
      });
    } else {
      writeLeanWorklog(workDir, {
        workId: task.id,
        taskTitle: task.id,
        implementationNote: 'No fixture solution applied; expecting negative retained.',
      });
    }

    if (!fs.existsSync(path.join(workDir, 'implementation.md'))) {
      fs.writeFileSync(
        path.join(workDir, 'implementation.md'),
        `# implementation\n${implementationNote}\n`
      );
    }

    const scored = scoreHoldoutIndependently(workDir, taskSandbox);
    assertNoL0ForHoldout(evalRoot, task.id);

    taskResults.push({
      id: task.id,
      path: task.path,
      content_sha256: task.content_sha256,
      pin_verified_before_mutation: true,
      sandbox_content_sha256: hashTaskContent(taskSandbox),
      agent: agentMeta,
      scores: scored.scores,
      delivered: scored.delivered,
      negative: !scored.delivered,
      negative_reason: scored.delivered ? undefined : scored.note,
      score_independence: {
        state_current_state: scored.state_current_state,
        state_says_done: scored.state_says_done,
        delivered_from_acceptance: scored.delivered,
        oracle_method: scored.oracle_method,
      },
      reached_validation: reachedValidationState({
        current_state: scored.state_current_state,
      }),
    });
  }

  const reachedValidation = taskResults.filter((t) => t.reached_validation).length;

  const report = buildHonestyReport({
    manifest_id: manifest.id,
    manifest_digest: manifest.manifest_digest || computeManifestDigest(manifest),
    pack_commit: manifest.pack_commit || null,
    provider,
    model: opts.model,
    label: opts.label || (provider === 'fixture' ? 'measured' : 'observed'),
    sole_e8_proof: false,
    e8_cited: e8Cited,
    cold_run: true,
    tasks: taskResults,
    limitations: opts.limitations,
  });

  report.harness = {
    reached_validation_count: reachedValidation,
    eval_root: evalRoot,
    results_must_not_commit: true,
    results_glob: 'bench/results/holdout-*',
  };

  const outPath = path.resolve(opts.out || defaultResultsPath(repoRoot, stamp));
  if (!path.basename(outPath).startsWith('holdout-')) {
    const err = new Error('holdout results must be written under a holdout-* filename');
    err.code = 'HOLDOUT_RESULTS_PATH';
    throw err;
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  const scorecardPath = outPath.replace(/\.json$/, '.scorecard.json');
  const scorecard = {
    generated_at: report.generated_at,
    kind: 'holdout-scorecard',
    summary: {
      pass_rate: report.summary.pass_rate,
      delivered: report.summary.delivered,
      tasks: report.summary.tasks,
    },
    tasks: taskResults.map((t) => ({
      id: t.id,
      delivered: t.delivered === true,
      scores: t.scores || { total: 0 },
    })),
  };
  fs.writeFileSync(scorecardPath, `${JSON.stringify(scorecard, null, 2)}\n`);

  return {
    ok: reachedValidation >= 1,
    report,
    scorecard,
    outPath,
    scorecardPath,
    reachedValidation,
    evalRoot,
  };
}

function plantRegressionScorecard(baselineScorecard, opts = {}) {
  const planted = JSON.parse(JSON.stringify(baselineScorecard));
  const targetId = opts.taskId || (planted.tasks[0] && planted.tasks[0].id);
  for (const t of planted.tasks || []) {
    if (t.id === targetId) {
      t.delivered = false;
      t.scores = {
        ...(t.scores || {}),
        total: Math.max(0, (t.scores?.total || 1) - 0.5),
        task_pass: 0,
      };
    }
  }
  if (planted.summary) {
    planted.summary.pass_rate = Math.max(0, (planted.summary.pass_rate || 1) - 0.5);
    planted.summary.delivered = Math.max(0, (planted.summary.delivered || 1) - 1);
  }
  planted.planted_regression = true;
  return planted;
}

module.exports = {
  copyDir,
  writeLeanWorklog,
  scoreHoldoutIndependently,
  runHoldoutSuite,
  plantRegressionScorecard,
  defaultResultsPath,
};
