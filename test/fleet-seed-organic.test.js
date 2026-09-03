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
    assert.equal(readiness.fleet_submission_ready, true);
    fs.rmSync(consumer, { recursive: true, force: true });
  });
});
