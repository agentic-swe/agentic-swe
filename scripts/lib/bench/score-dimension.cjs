'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { minimalChildEnv, resolveCommandArgv } = require('../shared/child-env.cjs');

const VALID_TRACKS = ['lean', 'standard', 'rigorous'];

/** Default wall-clock bound for corpus/acceptance child processes (ms). */
const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 60_000;

/**
 * Run an acceptance command from scoring dimension config.
 * Always bounded: spawnSync times out instead of hanging forever under load.
 * stdin is ignored so a held-open parent stdin cannot deadlock the child.
 * @returns {{ exitCode: number, stdout: string, stderr: string, timedOut?: boolean }}
 */
function runAcceptanceCommand(taskDir, dim) {
  const cwd = dim.cwd ? path.resolve(taskDir, dim.cwd) : path.resolve(taskDir);
  const resolved = resolveCommandArgv(dim.command);
  if (!resolved.ok || resolved.empty) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: (resolved && resolved.message) || 'acceptance command rejected',
    };
  }
  const timeoutMs =
    Number(dim.timeout_ms) > 0 ? Number(dim.timeout_ms) : DEFAULT_ACCEPTANCE_TIMEOUT_MS;
  const result = spawnSync(resolved.file, resolved.args, {
    cwd,
    shell: false,
    encoding: 'utf8',
    env: minimalChildEnv(),
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    // Do not inherit stdin — a parent holding stdin open can block children that read it.
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timedOut = Boolean(result.error && result.error.code === 'ETIMEDOUT');
  const stderrParts = [result.stderr || ''];
  if (timedOut) {
    stderrParts.push(`acceptance timed out after ${timeoutMs}ms`);
  } else if (result.error) {
    stderrParts.push(String(result.error.message || result.error));
  }
  return {
    exitCode: timedOut ? 124 : (result.status ?? 1),
    stdout: result.stdout || '',
    stderr: stderrParts.filter(Boolean).join('\n'),
    timedOut,
  };
}

function scoreTaskPass(taskDir, workDir, dim, patterns) {
  if (dim.method === 'run_acceptance_tests') {
    const { exitCode } = runAcceptanceCommand(taskDir, dim);
    const want = dim.full_credit_exit_code ?? 0;
    if (exitCode === want) return { score: 1.0, detail: `acceptance exit ${exitCode}` };
    return { score: 0, detail: `acceptance exit ${exitCode}, expected ${want}` };
  }

  if (dim.method === 'run_command') {
    const { exitCode } = runAcceptanceCommand(taskDir, dim);
    const want = dim.full_credit_exit_code ?? 0;
    if (exitCode === want) return { score: 1.0, detail: `command exit ${exitCode}` };
    return { score: 0, detail: `command exit ${exitCode}, expected ${want}` };
  }

  if (dim.method === 'worklog_completed') {
    const stateFile = path.join(workDir, 'state.json');
    if (!fs.existsSync(stateFile)) return { score: 0, detail: 'state.json missing' };
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.current_state === 'completed') return { score: 1.0, detail: 'completed' };
    if (state.current_state === 'pr-creation' || state.current_state === 'approval-wait') {
      return { score: dim.partial_credit ?? 0.8, detail: state.current_state };
    }
    if (state.current_state === 'validation') {
      return { score: dim.partial_credit ?? 0.5, detail: state.current_state };
    }
    return { score: 0, detail: state.current_state };
  }

  return { score: 0, detail: `unknown task_pass method: ${dim.method}` };
}

function hasTransitions(state) {
  return (state.history || []).some((h) => typeof h === 'object' && h && h.to);
}

function scoreCostEfficiency(workDir, dim) {
  const stateFile = path.join(workDir, 'state.json');
  if (!fs.existsSync(stateFile)) return { score: 0, detail: 'state.json missing' };
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (!hasTransitions(state)) return { score: 0, detail: 'no transitions recorded; no cost evidence' };
  if (typeof state.budget?.cost_used !== 'number') return { score: 0, detail: 'budget.cost_used not recorded' };
  const costUsed = state.budget.cost_used;
  const budget = dim.cost_budget_usd ?? state.budget?.cost_budget_usd ?? 3.0;
  if (costUsed <= budget) return { score: 1.0, detail: `$${costUsed.toFixed(4)} <= $${budget}` };
  const over = costUsed - budget;
  const score = Math.max(0, 1 - over / budget);
  return { score, detail: `$${costUsed.toFixed(4)} > $${budget}` };
}

function scoreCrossModel(workDir, dim, patterns) {
  const artifact = dim.artifact || 'design-panel-review.md';
  const exists = fs.existsSync(path.join(workDir, artifact));
  if (exists) return { score: 1.0, detail: `${artifact} present` };
  return { score: 0, detail: `${artifact} absent; no cross-model evidence` };
}

function scoreGateRespect(workDir, dim, patterns) {
  const stateFile = path.join(workDir, 'state.json');
  if (!fs.existsSync(stateFile)) return { score: 0, detail: 'state.json missing' };
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const history = state.history || [];
  if (!hasTransitions(state)) return { score: 0, detail: 'no transitions recorded; no gate evidence' };
  let penalty = 0;

  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1];
    const cur = history[i];
    if (typeof prev === 'object' && typeof cur === 'object') {
      if (prev.to !== cur.from) penalty += dim.penalize_skip ?? 0.2;
    }
  }

  const expectedTrack = dim.expected_track ?? patterns?.track_must_be;
  if (expectedTrack && state.pipeline?.track && state.pipeline.track !== expectedTrack) {
    penalty += dim.penalize_track_mismatch ?? 0.2;
  }

  const requiredStates = patterns?.required_states || [];
  const visited = new Set(
    history
      .filter((h) => typeof h === 'object' && h.to)
      .map((h) => h.to),
  );
  for (const req of requiredStates) {
    if (!visited.has(req)) penalty += dim.penalize_missing_state ?? 0.15;
  }

  const budgetRemaining = state.budget?.budget_remaining ?? 0;
  if (budgetRemaining < 0) penalty += dim.penalize_budget_overrun ?? 0.3;

  const score = Math.max(0, 1.0 - penalty);
  return { score, detail: `penalty ${penalty.toFixed(2)}` };
}

function checkPatterns(workDir, patterns) {
  const errors = [];
  if (!patterns) return { ok: true, errors };

  if (patterns.track_must_be) {
    const stateFile = path.join(workDir, 'state.json');
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const track = state.pipeline?.track;
      if (track && track !== patterns.track_must_be) {
        errors.push(`track is ${track}, expected ${patterns.track_must_be}`);
      }
    }
  }

  for (const req of patterns.required_patterns || []) {
    const filePath = path.join(workDir, req.file);
    if (!fs.existsSync(filePath)) {
      errors.push(`missing file for pattern: ${req.file}`);
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const re = new RegExp(req.pattern);
    if (!re.test(content)) {
      errors.push(`pattern not found in ${req.file}: ${req.pattern}`);
    }
  }

  for (const forb of patterns.forbidden_patterns || []) {
    const filePath = path.join(workDir, forb.file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    const re = new RegExp(forb.pattern);
    if (re.test(content)) {
      errors.push(`forbidden pattern in ${forb.file}: ${forb.pattern}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function scoreDimension(name, taskDir, workDir, dim, patterns) {
  switch (name) {
    case 'task_pass':
      return scoreTaskPass(taskDir, workDir, dim, patterns);
    case 'cost_efficiency':
      return scoreCostEfficiency(workDir, dim);
    case 'cross_model':
      return scoreCrossModel(workDir, dim, patterns);
    case 'gate_respect':
      return scoreGateRespect(workDir, dim, patterns);
    default:
      return { score: 0, detail: `unknown dimension ${name}` };
  }
}

module.exports = {
  VALID_TRACKS,
  hasTransitions,
  runAcceptanceCommand,
  scoreDimension,
  checkPatterns,
};
