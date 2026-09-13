'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildSubmissionReadiness } = require('./submission-readiness.cjs');
const { buildFleetConsumerChecklist } = require('./consumer-checklist.cjs');
const { normalizeFleetEvidenceClass } = require('./seed-organic-work.cjs');

/**
 * Persist consumer fleet submission progress for agents and hooks.
 * @param {{
 *   projectRoot: string,
 *   pluginRoot: string,
 *   muscleMemoryOk?: boolean,
 *   source?: string,
 * }} opts
 */
function buildFleetStatusSnapshot(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  if (projectRoot === pluginRoot) {
    return { skipped: true, reason: 'pack-root' };
  }

  const readiness = buildSubmissionReadiness({
    projectRoot,
    pluginRoot,
    muscleMemoryOk: opts.muscleMemoryOk,
  });
  const checklist = buildFleetConsumerChecklist({
    projectRoot,
    pluginRoot,
    muscleMemoryOk: opts.muscleMemoryOk,
  });

  return {
    updated_at: new Date().toISOString(),
    source: opts.source || 'fleet-status',
    goal_complete: false,
    fleet_evidence_class: normalizeFleetEvidenceClass(process.env.AGENTIC_SWE_FLEET_EVIDENCE_CLASS),
    consumer_mode: true,
    project_root: projectRoot,
    fleet_submission_ready: readiness.fleet_submission_ready,
    organic_live: readiness.organic_live,
    organic_with_tier_totals: readiness.organic_with_tier_totals,
    portfolio_multiplier: readiness.portfolio_multiplier,
    portfolio_target_met: readiness.portfolio_target_met,
    blockers: readiness.blockers,
    next_steps: checklist.steps,
    submit_command: `npm run fleet-submit -- --project-root ${projectRoot} --out fleet-submission.json`,
    measurement_contract:
      'Local consumer fleet progress snapshot. Independent fleet_evidence_class submissions count toward product goal_complete only after maintainer ingest at scale.',
  };
}

/**
 * @param {Parameters<typeof buildFleetStatusSnapshot>[0]} opts
 */
function writeFleetStatusSnapshot(opts) {
  const snapshot = buildFleetStatusSnapshot(opts);
  if (snapshot.skipped) return snapshot;

  const outPath = path.join(path.resolve(opts.projectRoot), '.agentic-swe', 'fleet-status.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  return { ok: true, path: outPath, snapshot };
}

/**
 * @param {string} projectRoot
 */
function readFleetStatusSnapshot(projectRoot) {
  const p = path.join(path.resolve(projectRoot), '.agentic-swe', 'fleet-status.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  buildFleetStatusSnapshot,
  writeFleetStatusSnapshot,
  readFleetStatusSnapshot,
};
