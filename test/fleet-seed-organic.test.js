'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedOrganicWorkItems } = require('../scripts/lib/fleet/seed-organic-work.cjs');
const { buildSubmissionReadiness } = require('../scripts/lib/fleet/submission-readiness.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('seedOrganicWorkItems', () => {
  it('seeds consumer organic work items with tier_totals', () => {
    const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-org-'));
    const r = seedOrganicWorkItems({ projectRoot: consumer, pluginRoot, count: 3 });
    assert.equal(r.seeded.length, 3);
    assert.ok(r.seeded.every((s) => s.has_tier_totals));
    const readiness = buildSubmissionReadiness({
      projectRoot: consumer,
      pluginRoot,
      muscleMemoryOk: true,
    });
    assert.equal(readiness.organic_live, 3);
    assert.equal(readiness.organic_with_tier_totals, 3);
    assert.deepEqual(readiness.organic_missing_tier_totals, []);
    // Seeding must never leave organic-count or tier_totals blockers. The portfolio
    // multiplier is deliberately not asserted here: a cold consumer pays L3 once on its
    // first item, so readiness depends on whether a procedure store already exists.
    // `fleet-onboard.test.js` covers the ready=true gate with deterministic tier_totals.
    assert.deepEqual(
      readiness.blockers.filter((b) => /organic|tier_totals/.test(b)),
      []
    );
    fs.rmSync(consumer, { recursive: true, force: true });
  });

  it('replays later items from the procedure the first item establishes', () => {
    const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-org-replay-'));
    seedOrganicWorkItems({ projectRoot: consumer, pluginRoot, count: 3 });
    const tiers = fs
      .readdirSync(path.join(consumer, '.worklogs'))
      .sort()
      .map((name) => {
        const state = JSON.parse(
          fs.readFileSync(path.join(consumer, '.worklogs', name, 'state.json'), 'utf8')
        );
        return state.metrics?.descent_tier;
      });
    assert.equal(tiers.length, 3);
    const replayed = tiers.filter((t) => t === 'L0' || t === 'L1').length;
    assert.ok(replayed >= 2, `expected ≥2 replayed items, got tiers ${tiers.join(',')}`);
    fs.rmSync(consumer, { recursive: true, force: true });
  });
});
