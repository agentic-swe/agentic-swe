#!/usr/bin/env node
/**
 * Bootstrap an external consumer repo for independent fleet-scale credit.
 * Does NOT seed synthetic work, does NOT set maintainer_dogfood, does NOT submit/ingest.
 *
 * Usage:
 *   node scripts/fleet-independent-bootstrap.cjs --consumer-root /path/to/repo [--merge-policy] [--write-workflow] [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { mergeClaudePolicy } = require('./merge-claude-policy.js');
const { runFleetOnboard } = require('./fleet-onboard.cjs');
const { buildSubmissionReadiness } = require('./lib/fleet/submission-readiness.cjs');
const { checkMuscleMemoryReadiness } = require('./lib/work-engine/muscle-memory-doctor.cjs');
const { isKnownMaintainerDogfoodConsumer } = require('./lib/fleet/dogfood-consumers.cjs');
const { writeFleetStatusSnapshot } = require('./lib/fleet/fleet-status-snapshot.cjs');

function parseArgs(argv) {
  const out = {
    json: false,
    mergePolicy: false,
    writeWorkflow: false,
    forceWorkflow: false,
    skipSessions: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--merge-policy') out.mergePolicy = true;
    else if (a === '--write-workflow') out.writeWorkflow = true;
    else if (a === '--force-workflow') out.forceWorkflow = true;
    else if (a === '--skip-sessions') out.skipSessions = true;
    else if (a === '--consumer-root') out.consumerRoot = path.resolve(argv[++i]);
    else if (a === '--project-root') out.consumerRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
  }
  return out;
}

async function runFleetIndependentBootstrap(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot || getDefaultPluginRoot());
  const consumerRoot = path.resolve(opts.consumerRoot);
  if (!fs.existsSync(consumerRoot)) {
    return { ok: false, error: `consumer root not found: ${consumerRoot}` };
  }
  if (consumerRoot === pluginRoot) {
    return { ok: false, error: 'consumer-root must differ from plugin pack root' };
  }

  const blockers = [];
  if (isKnownMaintainerDogfoodConsumer(pluginRoot, consumerRoot)) {
    blockers.push(
      'consumer-root was archived as maintainer_dogfood — use a distinct repo for independent fleet-scale credit'
    );
  }

  let policy = null;
  if (opts.mergePolicy) {
    policy = mergeClaudePolicy({ packRoot: pluginRoot, targetDir: consumerRoot, gitignore: true });
  }

  const onboard = await runFleetOnboard({
    projectRoot: consumerRoot,
    pluginRoot,
    skipSessions: opts.skipSessions,
    evolve: false,
    writeWorkflow: opts.writeWorkflow,
    forceWorkflow: opts.forceWorkflow,
  });

  const doctor = checkMuscleMemoryReadiness({ projectRoot: consumerRoot, pluginRoot });
  const readiness = buildSubmissionReadiness({
    projectRoot: consumerRoot,
    pluginRoot,
    muscleMemoryOk: doctor.ok,
  });
  const fleetStatus = writeFleetStatusSnapshot({
    projectRoot: consumerRoot,
    pluginRoot,
    muscleMemoryOk: doctor.ok,
    source: 'fleet-independent-bootstrap',
  });

  const envRecommendations = [
    `export AGENTIC_SWE_PROJECT_ROOT=${consumerRoot}`,
    'export AGENTIC_SWE_EVOLVE_ON_STOP=1',
    'export AGENTIC_SWE_FLEET_EVIDENCE_CLASS=independent',
    'Do not set AGENTIC_SWE_FLEET_EVIDENCE_CLASS=maintainer_dogfood',
  ];

  return {
    ok: blockers.length === 0 && doctor.ok,
    goal_complete: false,
    fleet_evidence_class: 'independent',
    measurement_contract:
      'Independent consumer bootstrap warms memory and records readiness. Fleet-scale credit requires ≥3 organic /work items and maintainer ingest — no synthetic seeding.',
    consumer_root: consumerRoot,
    plugin_root: pluginRoot,
    blockers: [...blockers, ...readiness.blockers],
    policy,
    onboard,
    submission_readiness: readiness,
    fleet_status: fleetStatus?.snapshot || fleetStatus,
    env_recommendations: envRecommendations,
    next_steps: [
      'Complete ≥3 organic /work items through validation→pr-creation (records budget.tier_totals)',
      `npm run work-engine -- doctor --project-root ${consumerRoot} --json`,
      `npm run fleet-submit -- --project-root ${consumerRoot} --out fleet-submission.json`,
      'Send fleet-submission.json to maintainer for ingest',
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.consumerRoot) {
    console.error('fleet-independent-bootstrap requires --consumer-root /path/to/repo');
    process.exit(2);
  }
  const payload = await runFleetIndependentBootstrap(args);
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log('fleet-independent-bootstrap: goal_complete=false');
    console.log(`  consumer: ${payload.consumer_root}`);
    console.log(`  fleet_evidence_class: ${payload.fleet_evidence_class}`);
    console.log(`  submission ready: ${payload.submission_readiness?.fleet_submission_ready}`);
    if (payload.blockers.length) {
      console.log('  blockers:');
      for (const b of payload.blockers) console.log(`    - ${b}`);
    }
    console.log('  next:');
    for (const step of payload.next_steps) console.log(`    - ${step}`);
  }
  process.exit(payload.ok && payload.submission_readiness?.fleet_submission_ready ? 0 : 1);
}

module.exports = { runFleetIndependentBootstrap };

if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
}
