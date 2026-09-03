'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const VALID_TRACKS = ['lean', 'standard', 'rigorous'];

/**
 * Run an acceptance command from scoring dimension config.
 * @returns {{ exitCode: number, stdout: string, stderr: string }}
 */
function runAcceptanceCommand(taskDir, dim) {
  const cwd = dim.cwd ? path.resolve(taskDir, dim.cwd) : path.resolve(taskDir);
  const result = spawnSync(dim.command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
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

function scoreCostEfficiency(workDir, dim) {
  const stateFile = path.join(workDir, 'state.json');
  if (!fs.existsSync(stateFile)) return { score: 0, detail: 'state.json missing' };
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const costUsed = state.budget?.cost_used ?? 0;
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
  const partial = dim.partial_credit ?? 0.5;
  const track = patterns?.track_must_be;
  if (track === 'lean') return { score: partial, detail: `lean track; ${artifact} optional` };
  return { score: partial, detail: `${artifact} absent` };
}

function scoreGateRespect(workDir, dim, patterns) {
  const stateFile = path.join(workDir, 'state.json');
  if (!fs.existsSync(stateFile)) return { score: 0, detail: 'state.json missing' };
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  const history = state.history || [];
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
  runAcceptanceCommand,
  scoreDimension,
  checkPatterns,
};
