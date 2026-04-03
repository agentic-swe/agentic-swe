'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const templatePath = path.join(__dirname, '..', '.claude', 'templates', 'state.json');

describe('state-schema: state.json template is valid and complete', () => {
  let state;

  it('parses as valid JSON', () => {
    const raw = fs.readFileSync(templatePath, 'utf8');
    state = JSON.parse(raw);
    assert.ok(state, 'state.json must parse without error');
  });

  it('has required top-level fields', () => {
    const raw = fs.readFileSync(templatePath, 'utf8');
    state = JSON.parse(raw);
    for (const key of ['current_state', 'budget', 'counters', 'pipeline', 'artifacts', 'history']) {
      assert.ok(key in state, `missing top-level field: ${key}`);
    }
  });

  it('budget has budget_remaining and cost_used', () => {
    const raw = fs.readFileSync(templatePath, 'utf8');
    state = JSON.parse(raw);
    assert.ok('budget_remaining' in state.budget, 'missing budget.budget_remaining');
    assert.ok('cost_used' in state.budget, 'missing budget.cost_used');
  });

  it('pipeline has tdd_mode, worktree_path, and lean track fields', () => {
    const raw = fs.readFileSync(templatePath, 'utf8');
    state = JSON.parse(raw);
    assert.ok('tdd_mode' in state.pipeline, 'missing pipeline.tdd_mode');
    assert.ok('worktree_path' in state.pipeline, 'missing pipeline.worktree_path');
    assert.ok('lean_track_eligible' in state.pipeline, 'missing pipeline.lean_track_eligible');
    assert.ok('lean_track_decision' in state.pipeline, 'missing pipeline.lean_track_decision');
    assert.ok(Object.prototype.hasOwnProperty.call(state.pipeline, 'track'), 'missing pipeline.track');
  });

  it('counters has self_review_iter, test_adequacy_iter, and lean_iter', () => {
    const raw = fs.readFileSync(templatePath, 'utf8');
    state = JSON.parse(raw);
    assert.ok('self_review_iter' in state.counters, 'missing counters.self_review_iter');
    assert.ok('test_adequacy_iter' in state.counters, 'missing counters.test_adequacy_iter');
    assert.ok('lean_iter' in state.counters, 'missing counters.lean_iter');
  });

  it('history is an empty array', () => {
    const raw = fs.readFileSync(templatePath, 'utf8');
    state = JSON.parse(raw);
    assert.ok(Array.isArray(state.history), 'history must be an array');
    assert.strictEqual(state.history.length, 0, 'history must start empty');
  });
});
