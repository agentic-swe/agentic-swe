'use strict';

const { buildSubmissionReadiness } = require('./submission-readiness.cjs');

/**
 * Actionable checklist for consumer teams pursuing fleet submission.
 * @param {{ projectRoot: string, pluginRoot: string, muscleMemoryOk?: boolean }} opts
 */
function buildFleetConsumerChecklist(opts) {
  const projectRoot = require('node:path').resolve(opts.projectRoot);
  const pluginRoot = require('node:path').resolve(opts.pluginRoot);
  const readiness = buildSubmissionReadiness({
    projectRoot,
    pluginRoot,
    muscleMemoryOk: opts.muscleMemoryOk,
  });

  const steps = [
    `export AGENTIC_SWE_PROJECT_ROOT=${projectRoot}`,
    'export AGENTIC_SWE_EVOLVE_ON_STOP=1',
    `npm run fleet-onboard -- --project-root ${projectRoot}`,
  ];

  if ((readiness.organic_live || 0) < 3) {
    steps.push(
      `Complete ≥3 organic /work items to completion (have ${readiness.organic_live || 0})`
    );
  }
  if ((readiness.organic_with_tier_totals || 0) < 3) {
    const missing = (readiness.organic_missing_tier_totals || []).slice(0, 5).join(', ');
    steps.push(
      `Ensure validation→pr-creation records budget.tier_totals (have ${readiness.organic_with_tier_totals || 0}; missing: ${missing || 'n/a'})`
    );
  }
  if (!readiness.portfolio_target_met) {
    steps.push(
      `Reduce production portfolio to ≤2% (current ${((readiness.portfolio_multiplier || 0) * 100).toFixed(2)}%)`
    );
  }

  steps.push(`npm run work-engine -- doctor --project-root ${projectRoot} --json`);
  steps.push(`npm run fleet-submit -- --project-root ${projectRoot} --out fleet-submission.json`);

  return {
    fleet_submission_ready: readiness.fleet_submission_ready,
    blockers: readiness.blockers,
    readiness,
    steps,
  };
}

module.exports = { buildFleetConsumerChecklist };
