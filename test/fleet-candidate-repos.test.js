'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { scanCandidateRepos } = require('../scripts/fleet-candidate-repos.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('fleet-candidate-repos', () => {
  it('scans hobby-projects parent and marks dogfood siblings ineligible', () => {
    const parent = path.resolve(pluginRoot, '..', '..');
    const r = scanCandidateRepos({ pluginRoot, parentDir: parent });
    assert.equal(r.ok, true);
    assert.equal(r.goal_complete, false);
    assert.ok(r.fleet_scale);
    const dogfood = r.candidates.filter((c) => c.maintainer_dogfood_archived);
    assert.ok(dogfood.length >= 3);
    for (const row of dogfood) {
      assert.equal(row.eligible_for_independent, false);
    }
    const eligible = r.candidates.filter((c) => c.eligible_for_independent);
    assert.ok(eligible.length >= 1);
  });
});
