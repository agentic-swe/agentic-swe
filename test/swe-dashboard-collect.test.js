'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectWorkDashboard } = require('../scripts/lib/work-engine/collect-work-dashboard.cjs');

function minimalState(overrides) {
  return {
    schema_version: 2,
    work_id: 'w1',
    task: 'hello task',
    current_state: 'feasibility',
    created_at: '2026-04-16T10:00:00.000Z',
    updated_at: '2026-04-16T10:30:00.000Z',
    timeout_at: '2026-04-17T10:00:00.000Z',
    owner: 'x',
    mode: 'full',
    resume: {},
    budget: {
      iteration_budget: 10,
      budget_remaining: 7,
      cost_budget_usd: 5,
      cost_used: 1.25,
      usage_totals: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
    counters: { subagent_spawns: 2, panel_runs: 1, design_iter: 0, code_iter: 0 },
    ambiguity: { detected: false, notes: [], resolved: false },
    approvals: { pr_approved: false, changes_requested: false },
    metrics: { tests_passed: false },
    risk: { level: 'unknown', score: null, top_items: [] },
    artifacts: {},
    validation: {},
    git: {},
    pipeline: { track: 'lean' },
    convergence: {},
    history: [
      { at: '2026-04-16T10:05:00.000Z', from: 'initialized', to: 'feasibility', actor: 'a' },
      { at: '2026-04-16T10:10:00.000Z', from: 'feasibility', to: 'lean-track-check', actor: 'a' },
      'freeform note',
    ],
    ...overrides,
  };
}

describe('collect-work-dashboard', () => {
  it('returns empty when no .worklogs', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-dash-'));
    try {
      const { items, rollup, total_count } = collectWorkDashboard(tmp);
      assert.deepStrictEqual(items, []);
      assert.strictEqual(rollup.work_item_count, 0);
      assert.strictEqual(total_count, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('aggregates items and rollup', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-dash-'));
    try {
      fs.mkdirSync(path.join(tmp, '.worklogs', 'a'), { recursive: true });
      fs.mkdirSync(path.join(tmp, '.worklogs', 'b'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.worklogs', 'a', 'state.json'), JSON.stringify(minimalState({ work_id: 'a' }), null, 2));
      fs.writeFileSync(
        path.join(tmp, '.worklogs', 'b', 'state.json'),
        JSON.stringify(
          minimalState({
            work_id: 'b',
            current_state: 'completed',
            budget: {
              iteration_budget: 8,
              budget_remaining: 0,
              cost_budget_usd: 3,
              cost_used: 0.5,
            },
          }),
          null,
          2
        )
      );

      const { items, rollup, total_count } = collectWorkDashboard(tmp);
      assert.strictEqual(items.length, 2);
      assert.strictEqual(total_count, 2);
      assert.strictEqual(rollup.work_item_count, 2);
      assert.strictEqual(rollup.completed_count, 1);
      assert.strictEqual(rollup.in_progress_count, 1);
      assert.ok(rollup.total_cost_used_usd > 0);
      assert.ok(rollup.total_cost_budget_usd >= 8);

      const rowA = items.find((i) => i.work_id === 'a');
      assert.ok(rowA);
      assert.strictEqual(rowA.work_dir_relative, '.worklogs/a');
      assert.strictEqual(rowA.is_completed, false);
      assert.strictEqual(rowA.iterations_used, 3);
      assert.strictEqual(rowA.tokens_total, 150);
      assert.strictEqual(rowA.duration_ms, 30 * 60 * 1000);
      assert.ok(Array.isArray(rowA.recent_transitions));
      assert.strictEqual(rowA.recent_transitions.length, 2);
      assert.strictEqual(rowA.recent_transitions[0].to, 'feasibility');
      assert.deepStrictEqual(rowA.state_histogram, { feasibility: 1, 'lean-track-check': 1 });

      const { buildRollup } = require('../scripts/lib/work-engine/collect-work-dashboard.cjs');
      const sub = buildRollup(items.filter((i) => i.work_id === 'a'));
      assert.strictEqual(sub.work_item_count, 1);
      assert.strictEqual(sub.in_progress_count, 1);

      const rowB = items.find((i) => i.work_id === 'b');
      assert.strictEqual(rowB.is_completed, true);

      const page = collectWorkDashboard(tmp, { limit: 1, offset: 0 });
      assert.strictEqual(page.items.length, 1);
      assert.strictEqual(page.total_count, 2);
      assert.strictEqual(page.rollup.work_item_count, 2);
      assert.strictEqual(page.rollup.completed_count, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
