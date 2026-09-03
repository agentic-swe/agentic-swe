#!/usr/bin/env node
/**
 * Honest fleet-learning status — what blocks the product goal_complete claim.
 *
 * Usage:
 *   node scripts/fleet-learning-status.cjs [--project-root dir] [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const {
  aggregateProductionTierTotals,
  productionPortfolioMultiplier,
} = require('./lib/bench/production-tier-totals.cjs');
const { aggregateOrganicSessionUsd } = require('./lib/bench/session-usd-portfolio.cjs');
const { summarizeProcedures } = require('./lib/skills/procedure-ritual-skills.cjs');
const { checkMuscleMemoryReadiness } = require('./lib/work-engine/muscle-memory-doctor.cjs');
const { buildSubmissionReadiness } = require('./lib/fleet/submission-readiness.cjs');
const { listArchivedSubmissions, summarizeFleetSubmissions } = require('./ingest-fleet-submission.cjs');
const { summarizeFleetArchiveEntries } = require('./lib/fleet/archive-summaries.cjs');
const { readFleetStatusSnapshot } = require('./lib/fleet/fleet-status-snapshot.cjs');
const { listMaintainerDogfoodConsumerRoots } = require('./lib/fleet/dogfood-consumers.cjs');

const TARGET = 0.02;

function latestJson(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort();
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
}

function main() {
  const pluginRoot = getDefaultPluginRoot();
  let projectRoot = pluginRoot;
  let exportInvitePath = null;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--project-root') projectRoot = path.resolve(process.argv[++i]);
    else if (process.argv[i] === '--export-invite') exportInvitePath = path.resolve(process.argv[++i]);
  }
  const json = process.argv.includes('--json');

  if (exportInvitePath) {
    const { spawnSync } = require('node:child_process');
    const r = spawnSync(process.execPath, ['scripts/fleet-export-invite.cjs', '--out', exportInvitePath], {
      cwd: pluginRoot,
      encoding: 'utf8',
    });
    if (r.status !== 0) {
      console.error(r.stderr || r.stdout);
      process.exit(r.status || 1);
    }
    if (!json) console.log(`fleet-learning-status: wrote invite ${exportInvitePath}`);
    if (json) {
      const payload = JSON.parse(fs.readFileSync(exportInvitePath, 'utf8'));
      console.log(JSON.stringify({ ok: true, export_invite: exportInvitePath, invite: payload }, null, 2));
    }
    return;
  }

  const resultsDir = path.join(pluginRoot, 'bench', 'results');
  const production = aggregateProductionTierTotals(projectRoot);
  const portfolio = productionPortfolioMultiplier(production);
  const sessionUsd = aggregateOrganicSessionUsd(projectRoot, pluginRoot);
  const consumerDescent = latestJson(resultsDir, 'consumer-repo-descent-');
  const objective = latestJson(resultsDir, 'objective-evidence-');
  const procedures = summarizeProcedures({ projectRoot, pluginRoot });
  const muscleMemory = checkMuscleMemoryReadiness({ projectRoot, pluginRoot });
  const submissionReadiness = buildSubmissionReadiness({
    projectRoot,
    pluginRoot,
    muscleMemoryOk: muscleMemory.ok,
  });
  const fleetSubmissionsAll = summarizeFleetSubmissions(pluginRoot);
  const fleetSubmissions = summarizeFleetSubmissions(pluginRoot, { forFleetScale: true });
  const fleetArchiveDetail = summarizeFleetArchiveEntries(listArchivedSubmissions(pluginRoot));
  const consumerFleetStatus =
    path.resolve(projectRoot) !== path.resolve(pluginRoot)
      ? readFleetStatusSnapshot(projectRoot)
      : null;

  const blockers = [];
  if (fleetSubmissions.distinct_independent_consumers < 3) {
    blockers.push(
      `Need ≥3 independent fleet submissions (have ${fleetSubmissions.distinct_independent_consumers}; archived_total=${fleetSubmissionsAll.archived}, maintainer_dogfood=${fleetArchiveDetail.maintainer_dogfood_count})`
    );
  }

  const payload = {
    ok: true,
    goal_complete: objective?.scorecard_all_met === true,
    measurement_contract:
      objective?.scorecard_all_met === true
        ? 'All pack objective requirements met including independent fleet-scale evidence.'
        : 'goal_complete false until independent fleet /work proves muscle memory at scale. Local scorecard_all_met does not satisfy the product objective.',
    project_root: projectRoot,
    pack_scorecard_local_met: objective?.scorecard_local_met === true,
    pack_scorecard_all_met: objective?.scorecard_all_met === true,
    production: {
      live_work_items: production.sources?.live ?? 0,
      organic_live: production.sources?.organic_live ?? 0,
      dogfood: production.sources?.dogfood ?? 0,
      portfolio_multiplier: portfolio.portfolio_multiplier,
      target_met: portfolio.portfolio_multiplier <= TARGET,
    },
    organic_session_usd: sessionUsd.summary,
    procedures,
    submission_readiness: submissionReadiness,
    fleet_submissions: fleetSubmissionsAll,
    fleet_submissions_independent: fleetSubmissions,
    fleet_archive_detail: fleetArchiveDetail,
    fleet_scale_progress: {
      independent_consumers: fleetSubmissions.distinct_independent_consumers,
      target: 3,
      maintainer_dogfood_consumers: listMaintainerDogfoodConsumerRoots(pluginRoot),
    },
    consumer_fleet_status: consumerFleetStatus,
    consumer_repo_descent: consumerDescent
      ? {
          target_met: consumerDescent.target_met === true,
          multiplier: consumerDescent.multiplier,
          memory_sqlite: consumerDescent.memory_sqlite,
          project_skill_evaluated: consumerDescent.project_skill_evaluated === true,
        }
      : null,
    blockers,
    next_steps: [
      'Run /work in consumer repos with AGENTIC_SWE_PROJECT_ROOT set',
      'npm run work-engine -- doctor --project-root <consumer> to verify muscle-memory readiness',
      'npm run skill-eval -- suggest --project-root <consumer> for procedure-backed promote candidates',
      'npm run fleet-export-invite -- --out fleet-team-invite.json',
      'npm run fleet-learning-status -- --export-invite fleet-team-invite.json',
      'npm run fleet-submit -- --project-root <consumer> --out fleet-submission.json',
      'npm run fleet-ingest-submission -- --submission fleet-submission.json  # maintainer',
      'npm run bench:suite to refresh evidence artifacts',
      'npm run live-production-status for pack-root tier_totals',
    ],
  };

  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log('fleet-learning-status: goal_complete=false (by design until fleet evidence)');
    console.log(`  pack scorecard_local_met: ${payload.pack_scorecard_local_met}`);
    console.log(`  pack scorecard_all_met: ${payload.pack_scorecard_all_met}`);
    console.log(
      `  live work items: ${payload.production.live_work_items}, organic_live: ${payload.production.organic_live}`
    );
    console.log(
      `  production portfolio: ${(payload.production.portfolio_multiplier * 100).toFixed(2)}% (target ≤${TARGET * 100}%)`
    );
    if (payload.consumer_repo_descent) {
      console.log(
        `  consumer-repo bench: target_met=${payload.consumer_repo_descent.target_met} mult=${(payload.consumer_repo_descent.multiplier * 100).toFixed(3)}%`
      );
    } else {
      console.log('  consumer-repo bench: no artifact (run npm run bench:consumer-repo-descent)');
    }
    if (sessionUsd.summary.billed_sessions > 0) {
      console.log(
        `  organic session USD (verify-replay): ${(sessionUsd.summary.session_usd_multiplier * 100).toFixed(3)}%`
      );
    }
    if (procedures.ritual_skills.length) {
      console.log(`  procedure ritual skills: ${procedures.ritual_skills.join(', ')}`);
    }
    console.log(
      `  fleet submission ready: ${payload.submission_readiness.fleet_submission_ready} (${payload.submission_readiness.blockers.length} blocker(s))`
    );
    console.log(
      `  fleet archives: total=${fleetSubmissionsAll.archived} independent=${fleetSubmissions.distinct_independent_consumers}/3 maintainer_dogfood=${fleetArchiveDetail.maintainer_dogfood_count}`
    );
    for (const e of fleetArchiveDetail.entries) {
      console.log(
        `    - ${e.fleet_evidence_class}: ${path.basename(e.project_root || '?')} organic=${e.organic_live} scale=${e.counts_toward_fleet_scale}`
      );
    }
    console.log('  blockers:');
    for (const b of blockers) console.log(`    - ${b}`);
  }
}

main();
