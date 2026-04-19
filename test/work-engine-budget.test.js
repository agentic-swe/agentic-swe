'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { checkBudgets } = require('../scripts/lib/work-engine/budget.cjs');

function baseState() {
  return JSON.parse(
    JSON.stringify({
      budget: {
        iteration_budget: 10,
        budget_remaining: 5,
        cost_budget_usd: 3,
        cost_used: 0,
      },
      counters: {
        lean_iter: 0,
        design_iter: 0,
        code_iter: 0,
        merge_iter: 0,
        approval_iter: 0,
        self_review_iter: 0,
        test_adequacy_iter: 0,
      },
      risk: { score: null },
    })
  );
}

describe('work-engine budget', () => {
  it('PROCEED when within limits', () => {
    const r = checkBudgets(baseState());
    assert.strictEqual(r.verdict, 'PROCEED');
    assert.strictEqual(r.ok, true);
  });

  it('STOP when budget_remaining is 0', () => {
    const s = baseState();
    s.budget.budget_remaining = 0;
    const r = checkBudgets(s);
    assert.strictEqual(r.verdict, 'STOP');
    assert.match(r.errors.join(' '), /budget_remaining/);
  });

  it('STOP when cost_used >= cost_budget_usd', () => {
    const s = baseState();
    s.budget.cost_used = 3;
    const r = checkBudgets(s);
    assert.strictEqual(r.verdict, 'STOP');
  });

  it('STOP when design_iter exceeds 3 when risk.score < 4', () => {
    const s = baseState();
    s.counters.design_iter = 4;
    const r = checkBudgets(s);
    assert.strictEqual(r.verdict, 'STOP');
  });

  it('allows design_iter 4 when risk.score >= 4', () => {
    const s = baseState();
    s.counters.design_iter = 4;
    s.risk.score = 4;
    const r = checkBudgets(s);
    assert.strictEqual(r.verdict, 'PROCEED');
  });
});
