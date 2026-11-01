'use strict';

const { applyTrackBudgetProfile } = require('./budget-config.cjs');
const { bump, rejectionCounter } = require('./counters.cjs');

/**
 * Compute the next work-item state for a validated transition. Pure: no fs, clock, or
 * process access; callers pass `now` and any loaded budget thresholds.
 * @param {object} input
 * @param {object} input.state current state.json contents (not mutated)
 * @param {string} input.from
 * @param {string} input.to
 * @param {string} input.now ISO timestamp
 * @param {string} [input.actor]
 * @param {string} [input.reason]
 * @param {string[]} [input.evidence_refs]
 * @param {string} [input.assigned_subagent]
 * @param {string} [input.setPipelineTrack]
 * @param {string[]} [input.changedPaths] appended (deduplicated) to pipeline.changed_paths
 * @param {string} [input.baseSha] recorded as pipeline.base_sha
 * @param {string} [input.acceptanceCommand]
 * @param {boolean} [input.testsPassed]
 * @param {object} [input.budgetThresholds] merged thresholds, required when leaving lean-track-check with a track
 * @param {boolean} [input.decrementIterationBudget=true]
 * @returns {{ next: object, entry: object }}
 */
function decideTransition(input) {
  const { state, from, to, now } = input;
  const next = structuredClone(state);
  next.current_state = to;
  next.updated_at = now;

  const changed = (input.changedPaths || []).filter(Boolean);
  if (input.setPipelineTrack || input.acceptanceCommand || changed.length || input.baseSha) {
    next.pipeline = next.pipeline || {};
  }
  if (changed.length) {
    next.pipeline.changed_paths = [...new Set([...(next.pipeline.changed_paths || []), ...changed])];
  }
  if (input.baseSha) {
    next.pipeline.base_sha = input.baseSha;
  }
  if (input.setPipelineTrack) {
    next.pipeline.track = input.setPipelineTrack;
  }
  if (input.acceptanceCommand) {
    next.pipeline.acceptance_command = input.acceptanceCommand;
  }
  if (input.testsPassed) {
    next.metrics = next.metrics || {};
    next.metrics.tests_passed = true;
  }

  if (from === 'lean-track-check' && next.pipeline && next.pipeline.track && input.budgetThresholds) {
    applyTrackBudgetProfile(next, next.pipeline.track, input.budgetThresholds, { updateMoney: true });
  }

  if (input.decrementIterationBudget !== false && typeof next.budget?.budget_remaining === 'number') {
    next.budget.budget_remaining = Math.max(0, next.budget.budget_remaining - 1);
  }

  const track = next.pipeline && next.pipeline.track;
  const counter = rejectionCounter(from, to, track);
  // approval_iter is written by `work approve` after this transition.
  if (counter && counter !== 'approval_iter') bump(next, counter);

  const entry = { at: now, actor: input.actor || 'unknown', from, to };
  if (counter) entry.counter = counter;
  if (input.reason) entry.reason = input.reason;
  if (input.evidence_refs && input.evidence_refs.length) entry.evidence_refs = input.evidence_refs;
  if (input.assigned_subagent) entry.assigned_subagent = input.assigned_subagent;

  if (!Array.isArray(next.history)) next.history = [];
  next.history.push(entry);

  return { next, entry };
}

module.exports = { decideTransition };
