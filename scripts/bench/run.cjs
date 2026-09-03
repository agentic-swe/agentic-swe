'use strict';

const fs = require('fs');
const path = require('path');
const { scoreWorklog } = require('../lib/bench/score-worklog.cjs');
const { discoverTasks } = require('../lib/bench/discover.cjs');
const { runTaskAcceptance, runBenchSuite } = require('../lib/bench/run-task.cjs');
const { VALID_TRACKS } = require('../lib/bench/score-dimension.cjs');

const REQUIRED_TASK_FILES = [
  'task.json',
  'scoring.json',
  'repo/package.json',
  path.join('expected', 'patterns.json'),
];

const TASK_JSON_REQUIRED_FIELDS = [
  'id', 'title', 'description', 'expected_track', 'acceptance_tests',
];

const SCORING_JSON_REQUIRED_FIELDS = [
  'task_pass', 'cost_efficiency', 'cross_model', 'gate_respect',
];

function validateTask(taskDir) {
  const errors = [];
  const warnings = [];
  const abs = path.resolve(taskDir);

  if (!fs.existsSync(abs)) {
    return { ok: false, errors: [`Task directory not found: ${abs}`], warnings };
  }

  const corpusKind = fs.existsSync(path.join(abs, 'corpus.json'));
  const requiredFiles = corpusKind
    ? ['task.json', 'scoring.json']
    : REQUIRED_TASK_FILES;

  for (const rel of requiredFiles) {
    if (!fs.existsSync(path.join(abs, rel))) {
      errors.push(`Missing required file: ${rel}`);
    }
  }

  const taskJsonPath = path.join(abs, 'task.json');
  let taskJson = null;
  if (fs.existsSync(taskJsonPath)) {
    try {
      taskJson = JSON.parse(fs.readFileSync(taskJsonPath, 'utf8'));
    } catch (e) {
      errors.push(`task.json is not valid JSON: ${e.message}`);
    }
    if (taskJson) {
      for (const field of TASK_JSON_REQUIRED_FIELDS) {
        if (taskJson[field] === undefined || taskJson[field] === null || taskJson[field] === '') {
          if (field === 'acceptance_tests' && Array.isArray(taskJson.acceptance_tests) && taskJson.acceptance_tests.length === 0) {
            errors.push(`task.json missing required field: ${field}`);
          } else if (field !== 'acceptance_tests' && !taskJson[field]) {
            errors.push(`task.json missing required field: ${field}`);
          }
        }
      }
      if (taskJson.expected_track && !VALID_TRACKS.includes(taskJson.expected_track)) {
        errors.push(`task.json.expected_track must be one of: ${VALID_TRACKS.join(', ')}`);
      }
      const dirId = path.basename(abs);
      if (taskJson.id && taskJson.id !== dirId) {
        warnings.push(`task.json.id (${taskJson.id}) does not match directory name (${dirId})`);
      }
    }
  }

  const scoringJsonPath = path.join(abs, 'scoring.json');
  if (fs.existsSync(scoringJsonPath)) {
    try {
      const scoringJson = JSON.parse(fs.readFileSync(scoringJsonPath, 'utf8'));
      for (const field of SCORING_JSON_REQUIRED_FIELDS) {
        if (!scoringJson[field]) {
          errors.push(`scoring.json missing required dimension: ${field}`);
        }
      }
      let weightSum = 0;
      for (const field of SCORING_JSON_REQUIRED_FIELDS) {
        if (scoringJson[field]?.weight) weightSum += scoringJson[field].weight;
      }
      if (Math.abs(weightSum - 1.0) > 0.01) {
        errors.push(`scoring.json dimension weights must sum to 1.0 (got ${weightSum.toFixed(3)})`);
      }
    } catch (e) {
      errors.push(`scoring.json is not valid JSON: ${e.message}`);
    }
  }

  const patternsJsonPath = path.join(abs, 'expected', 'patterns.json');
  if (fs.existsSync(patternsJsonPath)) {
    try {
      const patternsJson = JSON.parse(fs.readFileSync(patternsJsonPath, 'utf8'));
      if (!Array.isArray(patternsJson.required_patterns)) {
        errors.push('expected/patterns.json must have a required_patterns array');
      }
    } catch (e) {
      errors.push(`expected/patterns.json is not valid JSON: ${e.message}`);
    }
  }

  if (!corpusKind) {
    const repoSrc = path.join(abs, 'repo', 'src');
    if (fs.existsSync(repoSrc)) {
      const srcFiles = fs.readdirSync(repoSrc).filter((f) => f.endsWith('.js'));
      if (srcFiles.length === 0) warnings.push('repo/src/ has no .js files');
    } else {
      warnings.push('repo/src/ directory not found');
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const subcommand = args[0];
  const defaultTasksRoot = path.resolve(__dirname, '../../bench/tasks');
  const defaultCorpusRoot = path.resolve(__dirname, '../../bench/corpus');

  if (subcommand && !['validate', 'score', 'run', 'acceptance'].includes(subcommand)) {
    const workDir = args[0];
    const taskDir = args[1];
    const scores = scoreWorklog(workDir, taskDir);
    console.log(JSON.stringify(scores, null, 2));
    process.exit(scores.total >= 0.6 ? 0 : 1);
  }

  if (subcommand === 'score') {
    const workDir = args[1];
    const taskDir = args[2];
    if (!workDir) {
      console.error('Usage: node run.cjs score <work-dir> [task-dir]');
      process.exit(1);
    }
    const scores = scoreWorklog(workDir, taskDir);
    console.log(JSON.stringify(scores, null, 2));
    process.exit(scores.total >= 0.6 ? 0 : 1);
  }

  if (subcommand === 'acceptance') {
    const taskDir = args[1];
    if (!taskDir) {
      console.error('Usage: node run.cjs acceptance <task-dir>');
      process.exit(1);
    }
    const run = runTaskAcceptance(path.resolve(taskDir));
    if (run.stdout) process.stdout.write(run.stdout);
    if (run.stderr) process.stderr.write(run.stderr);
    process.exit(run.ok ? 0 : 1);
  }

  if (subcommand === 'run') {
    const tasksRootIdx = args.indexOf('--tasks-root');
    const corpusFlag = args.includes('--corpus');
    const outIdx = args.indexOf('--out');
    const tasksRoot = tasksRootIdx !== -1
      ? path.resolve(args[tasksRootIdx + 1])
      : (corpusFlag ? defaultCorpusRoot : defaultTasksRoot);
    const resultsDir = path.resolve(__dirname, '../../bench/results');
    const outPath = outIdx !== -1
      ? path.resolve(args[outIdx + 1])
      : path.join(resultsDir, `run-${new Date().toISOString().slice(0, 10)}.json`);

    const strict = args.includes('--strict');
    const { strictFail } = runBenchSuite(tasksRoot, outPath, { kind: corpusFlag ? 'corpus' : 'tasks' });
    console.log(`Wrote ${outPath}`);
    process.exit(strict && strictFail ? 1 : 0);
  }

  if (subcommand === 'validate') {
    const taskIdIdx = args.indexOf('--task');
    const allFlag = args.includes('--all');
    const corpusFlag = args.includes('--corpus');
    const tasksRootIdx = args.indexOf('--tasks-root');
    const tasksRoot = tasksRootIdx !== -1
      ? path.resolve(args[tasksRootIdx + 1])
      : (corpusFlag ? defaultCorpusRoot : defaultTasksRoot);

    let taskDirs = [];
    if (taskIdIdx !== -1) {
      taskDirs = [path.join(tasksRoot, args[taskIdIdx + 1])];
    } else {
      taskDirs = discoverTasks(tasksRoot);
    }

    if (taskDirs.length === 0) {
      console.error(`No tasks found under: ${tasksRoot}`);
      process.exit(1);
    }

    let allOk = true;
    for (const taskDir of taskDirs) {
      const taskId = path.basename(taskDir);
      const result = validateTask(taskDir);
      if (result.ok) console.log(`[PASS] ${taskId}`);
      else {
        console.log(`[FAIL] ${taskId}`);
        allOk = false;
      }
      for (const err of result.errors) console.log(`       ERROR: ${err}`);
      for (const warn of result.warnings) console.log(`       WARN:  ${warn}`);
    }

    console.log('');
    console.log(`Validated ${taskDirs.length} task(s). ${allOk ? 'All passed.' : 'Some failed.'}`);
    process.exit(allOk ? 0 : 1);
  }

  console.error('Usage:');
  console.error('  node run.cjs validate [--task <id>] [--all] [--corpus] [--tasks-root <path>]');
  console.error('  node run.cjs run [--corpus] [--tasks-root <path>] [--out <file>]');
  console.error('  node run.cjs acceptance <task-dir>');
  console.error('  node run.cjs score <work-dir> [task-dir]');
  process.exit(1);
}

module.exports = { scoreWorklog, validateTask, discoverTasks };
