#!/usr/bin/env node
/**
 * Consumer-repo fleet onboarding: warm memory scopes, capture organic work,
 * evolve procedures/skills, doctor check, and submission readiness.
 *
 * Does not mark goal_complete — packages honest signals for fleet evidence collection.
 *
 * Usage:
 *   node scripts/fleet-onboard.cjs [--project-root dir] [--skip-sessions] [--evolve-skills dry-run|1] [--json]
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { runMemoryScopeIngest } = require('./ingest-memory-scopes.cjs');
const { captureOrganicWorklogs } = require('./lib/descent/capture-organic-worklogs.cjs');
const { runEvolveCycle } = require('./evolve-cycle.cjs');
const { checkMuscleMemoryReadiness } = require('./lib/work-engine/muscle-memory-doctor.cjs');
const { buildSubmissionReadiness } = require('./lib/fleet/submission-readiness.cjs');
const { buildFleetConsumerChecklist } = require('./lib/fleet/consumer-checklist.cjs');
const { writeConsumerFleetWorkflow } = require('./lib/fleet/consumer-workflow.cjs');
const { writeFleetStatusSnapshot } = require('./lib/fleet/fleet-status-snapshot.cjs');

function parseArgs(argv) {
  const out = { json: false, skipSessions: false, evolve: true, writeWorkflow: false, forceWorkflow: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--skip-sessions') out.skipSessions = true;
    else if (a === '--all-hosts') out.allHosts = true;
    else if (a === '--no-evolve') out.evolve = false;
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--evolve-skills') out.evolveSkills = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--write-workflow') out.writeWorkflow = true;
    else if (a === '--force-workflow') out.forceWorkflow = true;
  }
  return out;
}

/**
 * @param {{ projectRoot: string, pluginRoot: string, skipSessions?: boolean, allHosts?: boolean, evolve?: boolean, evolveSkills?: string, limit?: number }} opts
 */
async function runFleetOnboard(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot);
  const consumerMode = projectRoot !== pluginRoot;

  const memory = await runMemoryScopeIngest({
    projectRoot,
    pluginRoot,
    skipSessions: opts.skipSessions,
    allHosts: opts.allHosts,
  });

  let organicCapture = { captured: 0, skipped: 0 };
  try {
    organicCapture = captureOrganicWorklogs({
      projectRoot,
      pluginRoot,
      includeFixtures: false,
      preferIsolatedTest: true,
    });
  } catch {
    /* optional */
  }

  let evolve = null;
  if (opts.evolve !== false) {
    const evolveSkills = opts.evolveSkills || '';
    const fullEvolve = evolveSkills === '1' || evolveSkills === 'true' || evolveSkills === 'dry-run';
    evolve = await runEvolveCycle({
      projectRoot,
      pluginRoot,
      limit: opts.limit || 8,
      promoteRituals: fullEvolve,
      scaffoldRituals: fullEvolve,
      dryRun: evolveSkills === 'dry-run',
    });
  }

  const doctor = checkMuscleMemoryReadiness({ projectRoot, pluginRoot });
  const submissionReadiness = buildSubmissionReadiness({
    projectRoot,
    pluginRoot,
    muscleMemoryOk: doctor.ok,
  });
  const consumerChecklist = buildFleetConsumerChecklist({
    projectRoot,
    pluginRoot,
    muscleMemoryOk: doctor.ok,
  });

  let consumerWorkflow = null;
  if (opts.writeWorkflow && consumerMode) {
    consumerWorkflow = writeConsumerFleetWorkflow({
      projectRoot,
      pluginRoot,
      force: opts.forceWorkflow === true,
    });
  }

  let fleetStatus = null;
  if (consumerMode) {
    fleetStatus = writeFleetStatusSnapshot({
      projectRoot,
      pluginRoot,
      muscleMemoryOk: doctor.ok,
      source: 'fleet-onboard',
    });
  }

  const envRecommendations = [
    `export AGENTIC_SWE_PROJECT_ROOT=${projectRoot}`,
    'export AGENTIC_SWE_EVOLVE_ON_STOP=1',
  ];
  if (!consumerMode) {
    envRecommendations.push(
      '# Set AGENTIC_SWE_PROJECT_ROOT to the consumer repo (not the plugin pack) for fleet credit'
    );
  }
  envRecommendations.push(
    '# Optional: export AGENTIC_SWE_EVOLVE_SKILLS=dry-run  # scaffold/promote ritual skills on session stop'
  );

  return {
    ok: doctor.ok,
    goal_complete: false,
    measurement_contract:
      'Fleet onboarding warms memory and reports submission readiness. goal_complete stays false until independent fleet /work proves muscle memory at scale.',
    consumer_mode: consumerMode,
    project_root: projectRoot,
    plugin_root: pluginRoot,
    memory,
    organic_capture: organicCapture,
    evolve,
    doctor,
    submission_readiness: submissionReadiness,
    consumer_checklist: consumerChecklist,
    consumer_workflow: consumerWorkflow,
    fleet_status: fleetStatus?.snapshot || fleetStatus,
    env_recommendations: envRecommendations,
    next_steps: consumerChecklist.steps,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const projectRoot = args.projectRoot || process.cwd();
  const payload = await runFleetOnboard({ ...args, projectRoot, pluginRoot });

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('fleet-onboard: goal_complete=false (fleet evidence still required)');
  console.log(`  consumer_mode: ${payload.consumer_mode}`);
  console.log(`  doctor ok: ${payload.doctor.ok}`);
  console.log(
    `  organic capture: ${payload.organic_capture.captured} captured, ${payload.organic_capture.skipped} skipped`
  );
  if (payload.evolve) {
    console.log(`  evolve procedures mined: ${payload.evolve.procedures_mined || 0}`);
  }
  console.log(
    `  submission ready: ${payload.submission_readiness.fleet_submission_ready} (${payload.submission_readiness.blockers.length} blocker(s))`
  );
  for (const b of payload.submission_readiness.blockers) console.log(`    - ${b}`);
  console.log('  checklist:');
  for (const step of payload.consumer_checklist.steps) console.log(`    - ${step}`);
  if (payload.consumer_workflow?.ok) {
    console.log(`  workflow: wrote ${payload.consumer_workflow.workflow_path}`);
  } else if (payload.consumer_workflow?.skipped) {
    console.log(`  workflow: skipped (${payload.consumer_workflow.error})`);
  }
  console.log('  env:');
  for (const line of payload.env_recommendations) console.log(`    ${line}`);
}

module.exports = { runFleetOnboard };

if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
}
