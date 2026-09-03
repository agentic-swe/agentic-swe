'use strict';

const fs = require('fs');
const path = require('path');
const { scoreDimension, checkPatterns } = require('./score-dimension.cjs');

const DIMENSIONS = ['task_pass', 'cost_efficiency', 'cross_model', 'gate_respect'];

/**
 * Score a worklog against task scoring.json and expected/patterns.json.
 * @param {string} workDir
 * @param {string} [taskDir]
 * @returns {object}
 */
function scoreWorklog(workDir, taskDir) {
  const result = {
    task_pass: 0,
    cost_efficiency: 0,
    cross_model: 0,
    gate_respect: 0,
    total: 0,
    details: {},
    pattern_errors: [],
    acceptance_pass: null,
  };

  const stateFile = path.join(workDir, 'state.json');
  if (!fs.existsSync(stateFile)) {
    return { ...result, error: 'state.json not found' };
  }

  let scoring = null;
  let patterns = null;

  if (taskDir) {
    const scoringPath = path.join(taskDir, 'scoring.json');
    const patternsPath = path.join(taskDir, 'expected', 'patterns.json');
    if (fs.existsSync(scoringPath)) {
      scoring = JSON.parse(fs.readFileSync(scoringPath, 'utf8'));
    }
    if (fs.existsSync(patternsPath)) {
      patterns = JSON.parse(fs.readFileSync(patternsPath, 'utf8'));
    }
  }

  if (!scoring) {
    return legacyScoreWorklog(workDir);
  }

  const patternCheck = checkPatterns(workDir, patterns);
  result.pattern_errors = patternCheck.errors;

  for (const dim of DIMENSIONS) {
    if (!scoring[dim]) continue;
    const { score, detail } = scoreDimension(dim, taskDir, workDir, scoring[dim], patterns);
    result[dim] = score;
    result.details[dim] = detail;
  }

  if (scoring.task_pass?.method === 'run_acceptance_tests' || scoring.task_pass?.method === 'run_command') {
    result.acceptance_pass = result.task_pass >= 1.0;
  }

  if (patterns && !patternCheck.ok && result.task_pass >= 1.0) {
    result.task_pass = Math.min(result.task_pass, 0.5);
    result.details.task_pass = `acceptance ok but patterns failed: ${patternCheck.errors.join('; ')}`;
  }

  let total = 0;
  for (const dim of DIMENSIONS) {
    const weight = scoring[dim]?.weight ?? 0;
    total += (result[dim] ?? 0) * weight;
  }
  result.total = total;

  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  result.usage_totals = state.budget?.usage_totals ?? null;
  result.tier_totals = state.budget?.tier_totals ?? null;
  result.cost_used = state.budget?.cost_used ?? 0;

  return result;
}

/** Fallback when no taskDir/scoring.json — preserves old proxy behavior. */
function legacyScoreWorklog(workDir) {
  const scores = {
    task_pass: 0,
    cost_efficiency: 0,
    cross_model: 0,
    gate_respect: 0,
    total: 0,
  };
  const state = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
  if (state.current_state === 'completed') scores.task_pass = 1.0;
  else if (state.current_state === 'pr-creation' || state.current_state === 'approval-wait') scores.task_pass = 0.8;
  else if (state.current_state === 'validation') scores.task_pass = 0.5;

  const costUsed = state.budget?.cost_used || 0;
  const costBudget = state.budget?.cost_budget_usd || 3.0;
  scores.cost_efficiency = costUsed <= costBudget ? 1.0 : Math.max(0, 1 - (costUsed - costBudget) / costBudget);

  let gatePenalty = 0;
  const history = state.history || [];
  for (let i = 1; i < history.length; i++) {
    if (typeof history[i - 1] === 'object' && typeof history[i] === 'object') {
      if (history[i - 1].to !== history[i].from) gatePenalty += 0.2;
    }
  }
  const budgetRespected = (state.budget?.budget_remaining || 0) >= 0;
  scores.gate_respect = Math.max(0, 1.0 - gatePenalty - (budgetRespected ? 0 : 0.3));

  scores.cross_model = fs.existsSync(path.join(workDir, 'design-panel-review.md')) ? 1.0 : 0.5;
  scores.total = scores.task_pass * 0.4 + scores.cost_efficiency * 0.2 + scores.cross_model * 0.2 + scores.gate_respect * 0.2;
  return scores;
}

module.exports = { scoreWorklog, legacyScoreWorklog, DIMENSIONS };
