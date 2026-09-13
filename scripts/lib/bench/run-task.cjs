'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { runAcceptanceCommand } = require('./score-dimension.cjs');
const { scoreWorklog } = require('./score-worklog.cjs');

/**
 * Run acceptance tests for a bench task (no LLM).
 * @param {string} taskDir
 * @returns {{ ok: boolean, exitCode: number, stdout: string, stderr: string }}
 */
function runTaskAcceptance(taskDir) {
  const absTask = path.resolve(taskDir);
  const scoringPath = path.join(absTask, 'scoring.json');
  if (!fs.existsSync(scoringPath)) {
    return { ok: false, exitCode: 1, stdout: '', stderr: 'scoring.json not found' };
  }
  const scoring = JSON.parse(fs.readFileSync(scoringPath, 'utf8'));
  const dim = scoring.task_pass;
  if (!dim || (dim.method !== 'run_acceptance_tests' && dim.method !== 'run_command')) {
    return { ok: false, exitCode: 1, stdout: '', stderr: 'task_pass has no runnable command' };
  }
  const result = runAcceptanceCommand(absTask, dim);
  const want = dim.full_credit_exit_code ?? 0;
  return {
    ok: result.exitCode === want,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * Score a task directory directly (acceptance only, no worklog).
 * Used for corpus oracle tasks.
 */
function scoreTaskDirect(taskDir) {
  const absTask = path.resolve(taskDir);
  const scoringPath = path.join(absTask, 'scoring.json');
  if (!fs.existsSync(scoringPath)) return { task_pass: 0, total: 0, error: 'no scoring.json' };

  const scoring = JSON.parse(fs.readFileSync(scoringPath, 'utf8'));
  const dim = scoring.task_pass;
  if (!dim) return { task_pass: 0, total: 0 };

  const result = runAcceptanceCommand(absTask, dim);
  const want = dim.full_credit_exit_code ?? 0;
  const taskPass = result.exitCode === want ? 1.0 : 0;

  let total = taskPass * (scoring.task_pass?.weight ?? 0.4);
  for (const name of ['cost_efficiency', 'cross_model', 'gate_respect']) {
    if (scoring[name]) {
      total += (scoring[name].default_score ?? 1.0) * (scoring[name].weight ?? 0);
    }
  }

  return {
    task_pass: taskPass,
    total,
    acceptance_pass: taskPass >= 1.0,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/**
 * Run all tasks under a root and write scorecard JSON.
 */
function runBenchSuite(tasksRoot, resultsPath, options = {}) {
  const { discoverTasks } = require('./discover.cjs');
  const taskDirs = discoverTasks(tasksRoot);
  const scorecard = {
    generated_at: new Date().toISOString(),
    tasks_root: tasksRoot,
    kind: options.kind || 'acceptance',
    tasks: [],
  };

  let allOk = true;
  for (const taskDir of taskDirs) {
    const taskId = path.basename(taskDir);
    const entry = { id: taskId, path: taskDir };

    if (options.worklogsRoot) {
      const workDir = path.join(options.worklogsRoot, taskId);
      if (fs.existsSync(workDir)) {
        entry.scores = scoreWorklog(workDir, taskDir);
        entry.delivered = entry.scores.acceptance_pass === true || entry.scores.task_pass >= 1.0;
      } else {
        entry.scores = scoreTaskDirect(taskDir);
        entry.delivered = entry.scores.acceptance_pass === true;
      }
    } else {
      const run = runTaskAcceptance(taskDir);
      entry.acceptance = run;
      entry.delivered = run.ok;
      entry.scores = scoreTaskDirect(taskDir);
    }

    if (!entry.delivered) allOk = false;
    scorecard.tasks.push(entry);
  }

  scorecard.summary = {
    total: scorecard.tasks.length,
    delivered: scorecard.tasks.filter((t) => t.delivered).length,
    pass_rate: scorecard.tasks.length
      ? scorecard.tasks.filter((t) => t.delivered).length / scorecard.tasks.length
      : 0,
  };

  fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
  fs.writeFileSync(resultsPath, `${JSON.stringify(scorecard, null, 2)}\n`);
  return { scorecard, allOk, strictFail: options.strict ? !allOk : false };
}

module.exports = {
  runTaskAcceptance,
  scoreTaskDirect,
  runBenchSuite,
};
