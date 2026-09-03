#!/usr/bin/env node
/**
 * Bootstrap a sibling consumer repo for fleet muscle-memory dogfood.
 * Sets fleet_evidence_class=maintainer_dogfood (excluded from fleet-scale counts).
 *
 * Usage:
 *   node scripts/fleet-consumer-bootstrap.cjs --consumer-root /path/to/repo [--merge-policy] [--seed-organic 3] [--submit] [--ingest] [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { mergeClaudePolicy } = require('./merge-claude-policy.js');
const { runFleetOnboard } = require('./fleet-onboard.cjs');
const { buildSubmissionReadiness } = require('./lib/fleet/submission-readiness.cjs');
const { checkMuscleMemoryReadiness } = require('./lib/work-engine/muscle-memory-doctor.cjs');
const { seedOrganicWorkItems } = require('./lib/fleet/seed-organic-work.cjs');
const { ingestFleetSubmission } = require('./ingest-fleet-submission.cjs');
const { writeConsumerFleetWorkflow } = require('./lib/fleet/consumer-workflow.cjs');

function parseArgs(argv) {
  const out = { json: false, mergePolicy: false, submit: false, ingest: false, seedOrganic: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--merge-policy') out.mergePolicy = true;
    else if (a === '--submit') out.submit = true;
    else if (a === '--ingest') out.ingest = true;
    else if (a === '--consumer-root') out.consumerRoot = path.resolve(argv[++i]);
    else if (a === '--project-root') out.consumerRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--seed-organic') out.seedOrganic = Number(argv[++i]) || 3;
    else if (a === '--skip-sessions') out.skipSessions = true;
    else if (a === '--write-workflow') out.writeWorkflow = true;
    else if (a === '--force-workflow') out.forceWorkflow = true;
  }
  return out;
}

async function runFleetConsumerBootstrap(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot || getDefaultPluginRoot());
  const consumerRoot = path.resolve(opts.consumerRoot);
  if (!fs.existsSync(consumerRoot)) {
    return { ok: false, error: `consumer root not found: ${consumerRoot}` };
  }
  if (consumerRoot === pluginRoot) {
    return { ok: false, error: 'consumer-root must differ from plugin pack root' };
  }

  let policy = null;
  if (opts.mergePolicy) {
    policy = mergeClaudePolicy({ packRoot: pluginRoot, targetDir: consumerRoot, gitignore: true });
  }

  let seed = null;
  if (opts.seedOrganic > 0) {
    seed = seedOrganicWorkItems({
      projectRoot: consumerRoot,
      pluginRoot,
      count: opts.seedOrganic,
    });
  }

  const onboard = await runFleetOnboard({
    projectRoot: consumerRoot,
    pluginRoot,
    skipSessions: opts.skipSessions,
    evolve: false,
    writeWorkflow: opts.writeWorkflow,
    forceWorkflow: opts.forceWorkflow,
  });

  let consumerWorkflow = null;
  if (opts.writeWorkflow && !onboard.consumer_workflow) {
    consumerWorkflow = writeConsumerFleetWorkflow({
      projectRoot: consumerRoot,
      pluginRoot,
      force: opts.forceWorkflow === true,
    });
  } else {
    consumerWorkflow = onboard.consumer_workflow;
  }

  const doctor = checkMuscleMemoryReadiness({ projectRoot: consumerRoot, pluginRoot });
  const readiness = buildSubmissionReadiness({
    projectRoot: consumerRoot,
    pluginRoot,
    muscleMemoryOk: doctor.ok,
  });

  let submit = null;
  const subPath = path.join(consumerRoot, 'fleet-submission.json');
  if (opts.submit) {
    const env = {
      ...process.env,
      AGENTIC_SWE_FLEET_EVIDENCE_CLASS: 'maintainer_dogfood',
    };
    const r = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts/fleet-submit.cjs'), '--project-root', consumerRoot, '--out', subPath],
      { encoding: 'utf8', env }
    );
    submit = { ok: r.status === 0, status: r.status, out: subPath };
    if (!submit.ok) submit.stderr = r.stderr || r.stdout;
  }

  let ingest = null;
  if (opts.ingest && submit?.ok) {
    ingest = await ingestFleetSubmission({ submissionPath: subPath, pluginRoot });
  }

  return {
    ok: onboard.ok && readiness.fleet_submission_ready === true,
    goal_complete: false,
    fleet_evidence_class: 'maintainer_dogfood',
    measurement_contract:
      'Maintainer dogfood on a real sibling consumer repo. Archived submissions are excluded from fleet-scale-independent counts.',
    consumer_root: consumerRoot,
    plugin_root: pluginRoot,
    policy,
    seed,
    onboard,
    consumer_workflow: consumerWorkflow,
    submission_readiness: readiness,
    submit,
    ingest,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.consumerRoot) {
    console.error('fleet-consumer-bootstrap requires --consumer-root /path/to/repo');
    process.exit(2);
  }
  const payload = await runFleetConsumerBootstrap(args);
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log('fleet-consumer-bootstrap: goal_complete=false');
    console.log(`  consumer: ${payload.consumer_root}`);
    console.log(`  submission ready: ${payload.submission_readiness?.fleet_submission_ready}`);
    if (payload.submit) console.log(`  submit: ${payload.submit.ok}`);
    if (payload.ingest) console.log(`  ingest: ${payload.ingest.ok}`);
    if (!payload.ok && payload.error) console.error(`  error: ${payload.error}`);
  }
  process.exit(payload.ok ? 0 : 1);
}

module.exports = { runFleetConsumerBootstrap };

if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
}
