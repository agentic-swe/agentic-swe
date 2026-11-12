'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  routeSkills,
  FALLBACK_CODES,
} = require('../scripts/lib/skills/skill-router.cjs');
const {
  resolveRoutingFallback,
} = require('../scripts/lib/skills/routing-fallback.cjs');

const root = path.join(__dirname, '..');

describe('AE-026b routing fallback matrix', () => {
  it('EMPTY_CATALOG when skills list is empty', () => {
    const r = routeSkills({
      pluginRoot: root,
      query: 'check budget',
      k: 5,
      skills: [],
    });
    assert.deepEqual(r.results, []);
    assert.equal(r.fallback?.code, FALLBACK_CODES.EMPTY_CATALOG);
  });

  it('ALL_GATED when autonomous and every skill is gate-blocked', () => {
    const r = routeSkills({
      pluginRoot: root,
      query: 'alpha beta routing fixture',
      k: 5,
      autonomous: true,
      skills: [
        {
          name: 'fixture-gated-alpha',
          description: 'alpha beta routing fixture skill',
          kind: 'command',
          eval_status: 'lint_passed',
        },
        {
          name: 'fixture-gated-beta',
          description: 'alpha beta routing fixture skill',
          kind: 'command',
          eval_status: 'lint_passed',
        },
      ],
    });
    assert.equal(r.results.length, 0);
    assert.ok(r.rejected.length >= 1);
    assert.equal(r.fallback?.code, FALLBACK_CODES.ALL_GATED);
    for (const row of r.rejected) {
      assert.ok(row.reasons.includes('EVAL_GATE'));
    }
  });

  it('TIE_BREAK uses alphabetical name order', () => {
    const r = routeSkills({
      pluginRoot: root,
      query: 'sharedtoken',
      k: 5,
      // Non-autonomous so unknown fixture names stay selectable for ordering.
      autonomous: false,
      lowConfidenceScore: 0,
      skills: [
        {
          name: 'zeta-tie',
          description: 'sharedtoken skill',
          kind: 'command',
          eval_status: 'evaluated',
        },
        {
          name: 'alpha-tie',
          description: 'sharedtoken skill',
          kind: 'command',
          eval_status: 'evaluated',
        },
      ],
    });
    assert.ok(r.results.length >= 2);
    assert.equal(r.results[0].score, r.results[1].score);
    assert.equal(r.results[0].name, 'alpha-tie');
    assert.equal(r.results[1].name, 'zeta-tie');
    assert.equal(r.fallback?.code, FALLBACK_CODES.TIE_BREAK);
  });

  it('LOW_CONFIDENCE when top score is below bar', () => {
    const r = routeSkills({
      pluginRoot: root,
      query: 'zzzz-unrelated-no-match-token',
      k: 3,
      // Capability default adds 0.5 when query has no inferred caps; bar must sit above that.
      lowConfidenceScore: 0.6,
      skills: [
        {
          name: 'fixture-low',
          description: 'completely different words here',
          kind: 'command',
          eval_status: 'evaluated',
        },
      ],
    });
    assert.ok(r.results.length >= 1);
    assert.ok(r.results[0].score < 0.6);
    assert.equal(r.fallback?.code, FALLBACK_CODES.LOW_CONFIDENCE);
  });

  it('resolveRoutingFallback fails closed on null/blank inputs', () => {
    assert.throws(() => resolveRoutingFallback(null), /required/);
    assert.throws(
      () =>
        resolveRoutingFallback({
          catalogSize: 1,
          results: null,
          rejected: [],
        }),
      /required/
    );
    assert.throws(
      () =>
        resolveRoutingFallback({
          catalogSize: -1,
          results: [],
          rejected: [],
        }),
      /catalogSize/
    );
  });

  it('NO_SKILL when non-autonomous results empty after filters', () => {
    const fb = resolveRoutingFallback({
      catalogSize: 2,
      results: [],
      rejected: [{ name: 'x', reasons: ['CAPABILITY_MISMATCH'] }],
      autonomous: false,
    });
    assert.equal(fb.code, FALLBACK_CODES.NO_SKILL);
  });
});
