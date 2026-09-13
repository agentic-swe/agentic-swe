#!/usr/bin/env node
/**
 * Export a shareable fleet onboarding invite for external consumer teams.
 * Default fleet_evidence_class=independent (counts toward fleet-scale when ingested).
 *
 * Usage:
 *   node scripts/fleet-export-invite.cjs [--plugin-root dir] [--out fleet-team-invite.json] [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { summarizeFleetSubmissions } = require('./ingest-fleet-submission.cjs');
const { summarizeFleetArchiveEntries } = require('./lib/fleet/archive-summaries.cjs');
const { listArchivedSubmissions } = require('./ingest-fleet-submission.cjs');
const { buildFleetConsumerChecklist } = require('./lib/fleet/consumer-checklist.cjs');
const { listMaintainerDogfoodConsumerRoots } = require('./lib/fleet/dogfood-consumers.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--out') out.outPath = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const scale = summarizeFleetSubmissions(pluginRoot, { forFleetScale: true });
  const detail = summarizeFleetArchiveEntries(listArchivedSubmissions(pluginRoot));

  const templateChecklist = buildFleetConsumerChecklist({
    projectRoot: '/path/to/your-consumer-repo',
    pluginRoot,
    muscleMemoryOk: true,
  });

  const payload = {
    generated_at: new Date().toISOString(),
    goal_complete: false,
    fleet_evidence_class: 'independent',
    measurement_contract:
      'Share with external consumer teams. Submissions must use fleet_evidence_class=independent (default) and real organic /work with tier_totals. maintainer_dogfood is excluded from fleet-scale counts.',
    maintainer_status: {
      independent_consumers: scale.distinct_independent_consumers,
      fleet_scale_target: 3,
      archived_total: summarizeFleetSubmissions(pluginRoot).archived,
      maintainer_dogfood: detail.maintainer_dogfood_count,
      excluded_dogfood_consumer_roots: listMaintainerDogfoodConsumerRoots(pluginRoot),
    },
    consumer_setup: [
      'Install agentic-swe plugin in your repo',
      'export AGENTIC_SWE_PROJECT_ROOT=/absolute/path/to/your-repo',
      'npm run fleet-onboard -- --project-root "$AGENTIC_SWE_PROJECT_ROOT"',
      'Complete ≥3 /work items through validation→pr-creation (records budget.tier_totals)',
      'npm run work-engine -- doctor --project-root "$AGENTIC_SWE_PROJECT_ROOT" --json',
      'npm run fleet-submit -- --project-root "$AGENTIC_SWE_PROJECT_ROOT" --out fleet-submission.json',
      'Send fleet-submission.json to maintainer for: npm run fleet-ingest-submission -- --submission fleet-submission.json',
    ],
    checklist_template: templateChecklist,
    env: {
      AGENTIC_SWE_PROJECT_ROOT: '/path/to/your-consumer-repo',
      AGENTIC_SWE_EVOLVE_ON_STOP: '1',
      AGENTIC_SWE_FLEET_EVIDENCE_CLASS: 'independent',
    },
    do_not: [
      'Do not set AGENTIC_SWE_FLEET_EVIDENCE_CLASS=maintainer_dogfood for external teams',
      'Do not seed synthetic worklogs for fleet credit',
      'Do not submit from the plugin pack root',
      'Do not reuse repos archived as maintainer_dogfood for independent fleet credit',
    ],
  };

  const text = JSON.stringify(payload, null, 2);
  if (args.outPath) fs.writeFileSync(args.outPath, `${text}\n`);
  if (args.json || !args.outPath) console.log(text);
  else console.log(`fleet-export-invite: wrote ${args.outPath}`);
}

main();
