'use strict';

const path = require('node:path');
const { isIndependentFleetSubmission } = require('./seed-organic-work.cjs');

/**
 * @param {object} submission
 */
function summarizeArchiveEntry(submission) {
  const readiness = submission.evidence?.submission_readiness || submission;
  return {
    project_root: submission.project_root ? path.resolve(submission.project_root) : null,
    fleet_evidence_class: submission.fleet_evidence_class || 'independent',
    counts_toward_fleet_scale: isIndependentFleetSubmission(submission),
    submitted_at: submission.submitted_at || null,
    organic_live: readiness.organic_live ?? null,
    portfolio_multiplier: readiness.portfolio_multiplier ?? null,
    git_origin: submission.git?.origin || null,
  };
}

/**
 * @param {object[]} archived
 */
function summarizeFleetArchiveEntries(archived) {
  const entries = archived.map(summarizeArchiveEntry);
  const independent = entries.filter((e) => e.counts_toward_fleet_scale);
  return {
    entries,
    independent_count: independent.length,
    maintainer_dogfood_count: entries.filter((e) => e.fleet_evidence_class === 'maintainer_dogfood').length,
    bootstrap_count: entries.filter((e) => e.fleet_evidence_class === 'bootstrap').length,
    fleet_scale_target: 3,
    fleet_scale_met: independent.length >= 3,
    independent_roots: [...new Set(independent.map((e) => e.project_root).filter(Boolean))],
  };
}

module.exports = { summarizeArchiveEntry, summarizeFleetArchiveEntries };
