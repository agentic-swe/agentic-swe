'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { routeSkills, SCORE_BREAKDOWN_KEYS } = require('../scripts/lib/skills/skill-router.cjs');

const root = path.join(__dirname, '..');

describe('AE-026a explainable skill routing', () => {
  it('returns ordered skills with stable score_breakdown keys', () => {
    const r = routeSkills({
      pluginRoot: root,
      query: 'security vulnerability code review',
      k: 8,
    });
    assert.ok(r.results.length > 0);
    assert.deepEqual(r.score_breakdown_keys, [...SCORE_BREAKDOWN_KEYS]);
    for (const row of r.results) {
      assert.ok(row.score_breakdown);
      for (const key of SCORE_BREAKDOWN_KEYS) {
        assert.equal(typeof row.score_breakdown[key], 'number', key);
      }
    }
    // Ordered by score desc
    for (let i = 1; i < r.results.length; i++) {
      assert.ok(r.results[i - 1].score >= r.results[i].score);
    }
  });

  it('puts irrelevant / gated skills in rejected[] with reason codes', () => {
    const r = routeSkills({
      pluginRoot: root,
      query: 'security vulnerability penetration test',
      k: 5,
      autonomous: true,
    });
    assert.ok(Array.isArray(r.rejected));
    assert.ok(r.rejected.length > 0, 'expected rejected entries');
    const reasons = new Set(r.rejected.flatMap((x) => x.reasons));
    assert.ok(
      reasons.has('EVAL_GATE') || reasons.has('CAPABILITY_MISMATCH') || reasons.has('COMPAT'),
      `expected known reason codes, got ${[...reasons]}`
    );
    // lint_passed never auto-selected
    for (const row of r.results) {
      assert.notEqual(row.eval_status, 'lint_passed');
      assert.equal(row.autonomous_allowed, true);
    }
  });

  it('autonomous path consults eval-gate; lint_passed never auto-selected', () => {
    const r = routeSkills({
      pluginRoot: root,
      query: 'seo specialist marketing',
      k: 10,
      autonomous: true,
    });
    for (const row of r.results) {
      assert.equal(row.autonomous_allowed, true);
      assert.notEqual(row.eval_status, 'lint_passed');
      assert.notEqual(row.eval_status, 'unevaluated');
    }
    assert.equal(r.unevaluated_in_top_k, 0);
    // Gate rejects must be explicit — never a no-op length>=0 assertion.
    const lintRejected = r.rejected.filter((x) => x.reasons.includes('EVAL_GATE'));
    assert.ok(
      lintRejected.length > 0 || r.results.every((row) => row.eval_status === 'evaluated'),
      'expected EVAL_GATE rejects or only evaluated results'
    );
  });

  it('blank/null query does not skip score_breakdown; no network', () => {
    for (const query of ['', null, undefined]) {
      const r = routeSkills({ pluginRoot: root, query, k: 3 });
      assert.deepEqual(r.score_breakdown_keys, [...SCORE_BREAKDOWN_KEYS]);
      assert.ok(Array.isArray(r.results));
      assert.ok(Array.isArray(r.rejected));
      for (const row of r.results) {
        for (const key of SCORE_BREAKDOWN_KEYS) {
          assert.equal(typeof row.score_breakdown[key], 'number', `${String(query)}:${key}`);
        }
      }
    }
  });

  it('zero non-loopback network in tests (transport spy never called)', () => {
    let fetches = 0;
    const transport = {
      fetch: async () => {
        fetches += 1;
        return { ok: true };
      },
    };
    routeSkills({
      pluginRoot: root,
      query: 'check budget',
      k: 3,
      transport,
    });
    assert.equal(fetches, 0);
    assert.throws(() =>
      routeSkills({
        pluginRoot: root,
        query: 'check budget',
        k: 1,
        transport,
        forceNetwork: true,
      })
    );
  });
});
