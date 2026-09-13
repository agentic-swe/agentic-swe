#!/usr/bin/env node
/**
 * Consumer team fleet evidence submission — validates readiness and writes bundle.
 * Does not mark goal_complete. Fails closed when blockers remain.
 *
 * Usage:
 *   npm run fleet-submit -- --project-root /path/to/consumer-repo [--out fleet-submission.json] [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { collectFleetEvidence } = require('./fleet-evidence-bundle.cjs');
const { normalizeFleetEvidenceClass } = require('./lib/fleet/seed-organic-work.cjs');
const { writeFleetStatusSnapshot } = require('./lib/fleet/fleet-status-snapshot.cjs');
const { checkMuscleMemoryReadiness } = require('./lib/work-engine/muscle-memory-doctor.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--out') out.outPath = path.resolve(argv[++i]);
  }
  return out;
}

function readGitRemote(projectRoot) {
  try {
    const url = execSync('git remote get-url origin', { cwd: projectRoot, encoding: 'utf8' }).trim();
    const head = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf8' }).trim();
    return { origin: url, head };
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv);
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const projectRoot = args.projectRoot || process.cwd();

  if (path.resolve(projectRoot) === path.resolve(pluginRoot)) {
    const msg =
      'fleet-submit requires a consumer repo (--project-root must differ from plugin pack root)';
    if (args.json) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(msg);
    process.exit(1);
  }

  const evidence = collectFleetEvidence({ projectRoot, pluginRoot });
  const readiness = evidence.submission_readiness;
  const fleetEvidenceClass = normalizeFleetEvidenceClass(process.env.AGENTIC_SWE_FLEET_EVIDENCE_CLASS);

  if (fleetEvidenceClass === 'independent') {
    const { isKnownMaintainerDogfoodConsumer } = require('./lib/fleet/dogfood-consumers.cjs');
    if (isKnownMaintainerDogfoodConsumer(pluginRoot, projectRoot)) {
      const msg =
        'fleet-submit independent class rejected: this consumer was archived as maintainer_dogfood — use a distinct external repo for fleet-scale credit';
      if (args.json) console.log(JSON.stringify({ ok: false, error: msg }));
      else console.error(msg);
      process.exit(1);
    }
  }

  const payload = {
    submitted_at: new Date().toISOString(),
    goal_complete: false,
    fleet_evidence_class: fleetEvidenceClass,
    measurement_contract:
      fleetEvidenceClass === 'independent'
        ? 'Consumer fleet submission artifact for maintainer review. Does not satisfy product goal_complete without independent fleet validation at scale.'
        : `Consumer fleet submission (${fleetEvidenceClass}) — archived for maintainer review but excluded from fleet-scale-independent counts.`,
    project_root: projectRoot,
    plugin_root: pluginRoot,
    git: readGitRemote(projectRoot),
    fleet_submission_ready: readiness.fleet_submission_ready,
    blockers: readiness.blockers,
    evidence,
  };

  const text = JSON.stringify(payload, null, 2);
  if (args.outPath) fs.writeFileSync(args.outPath, `${text}\n`);

  try {
    const doctor = checkMuscleMemoryReadiness({ projectRoot, pluginRoot });
    writeFleetStatusSnapshot({
      projectRoot,
      pluginRoot,
      muscleMemoryOk: doctor.ok,
      source: 'fleet-submit',
    });
  } catch {
    /* optional */
  }

  if (args.json || !args.outPath) console.log(text);
  else {
    console.log(`fleet-submit: wrote ${args.outPath}`);
    console.log(`  submission_ready: ${readiness.fleet_submission_ready}`);
    if (!readiness.fleet_submission_ready) {
      for (const b of readiness.blockers) console.log(`  blocker: ${b}`);
    }
  }

  process.exit(readiness.fleet_submission_ready ? 0 : 1);
}

if (require.main === module) main();

module.exports = { readGitRemote };
