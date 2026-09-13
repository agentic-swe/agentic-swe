'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeFleetArchiveEntries } = require('../scripts/lib/fleet/archive-summaries.cjs');

describe('summarizeFleetArchiveEntries', () => {
  it('counts independent vs maintainer_dogfood toward fleet scale', () => {
    const detail = summarizeFleetArchiveEntries([
      { project_root: '/tmp/a', fleet_evidence_class: 'independent', evidence: { submission_readiness: { organic_live: 3 } } },
      { project_root: '/tmp/b', fleet_evidence_class: 'maintainer_dogfood', evidence: { submission_readiness: { organic_live: 3 } } },
      { project_root: '/tmp/c', fleet_evidence_class: 'maintainer_dogfood', evidence: { submission_readiness: { organic_live: 3 } } },
    ]);
    assert.equal(detail.independent_count, 1);
    assert.equal(detail.maintainer_dogfood_count, 2);
    assert.equal(detail.fleet_scale_met, false);
    assert.equal(detail.independent_roots.length, 1);
  });
});
