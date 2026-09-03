#!/usr/bin/env node
/**
 * Collect fleet muscle-memory evidence bundle for external team submission.
 * goal_complete stays false — this packages honest local/fleet signals only.
 *
 * Usage:
 *   node scripts/fleet-evidence-bundle.cjs [--project-root dir] [--out path] [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { checkMuscleMemoryReadiness } = require('./lib/work-engine/muscle-memory-doctor.cjs');
const { suggestSkillEvalFromProcedures } = require('./lib/skills/skill-eval-suggestions.cjs');
const { summarizeProcedures } = require('./lib/skills/procedure-ritual-skills.cjs');
const {
  aggregateProductionTierTotals,
  productionPortfolioMultiplier,
} = require('./lib/bench/production-tier-totals.cjs');
const { aggregateOrganicSessionUsd } = require('./lib/bench/session-usd-portfolio.cjs');
const {
  buildSubmissionReadiness,
  latestJson,
} = require('./lib/fleet/submission-readiness.cjs');
const { buildFleetConsumerChecklist } = require('./lib/fleet/consumer-checklist.cjs');
const { summarizeFleetSubmissions, listArchivedSubmissions } = require('./ingest-fleet-submission.cjs');
const { summarizeFleetArchiveEntries } = require('./lib/fleet/archive-summaries.cjs');

function collectFleetEvidence(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot || pluginRoot);
  const resultsDir = path.join(pluginRoot, 'bench', 'results');
  const production = aggregateProductionTierTotals(projectRoot);
  const portfolio = productionPortfolioMultiplier(production);
  const sessionUsd = aggregateOrganicSessionUsd(projectRoot, pluginRoot);

  const muscleMemory = checkMuscleMemoryReadiness({ projectRoot, pluginRoot });
  const skillEval = suggestSkillEvalFromProcedures({ projectRoot, pluginRoot });
  const submissionReadiness = buildSubmissionReadiness({
    projectRoot,
    pluginRoot,
    muscleMemoryOk: muscleMemory.ok,
  });

  return {
    generated_at: new Date().toISOString(),
    goal_complete: false,
    measurement_contract:
      'Fleet evidence bundle for maintainer review. Does not satisfy product goal_complete without independent team organic /work at scale.',
    project_root: projectRoot,
    plugin_root: pluginRoot,
    consumer_mode: projectRoot !== pluginRoot,
    muscle_memory: muscleMemory,
    procedures: summarizeProcedures({ projectRoot, pluginRoot }),
    skill_eval: skillEval,
    production: {
      sources: production.sources,
      portfolio_multiplier: portfolio.portfolio_multiplier,
      target_met: portfolio.portfolio_multiplier <= 0.02,
    },
    organic_session_usd: sessionUsd.summary,
    submission_readiness: submissionReadiness,
    consumer_checklist: buildFleetConsumerChecklist({
      projectRoot,
      pluginRoot,
      muscleMemoryOk: muscleMemory.ok,
    }),
    bench_artifacts: {
      objective_evidence: latestJson(resultsDir, 'objective-evidence-'),
      consumer_repo_descent: latestJson(resultsDir, 'consumer-repo-descent-'),
      consumer_fleet_readiness: latestJson(resultsDir, 'consumer-fleet-readiness-'),
      fleet_submissions: summarizeFleetSubmissions(pluginRoot),
      fleet_submissions_independent: summarizeFleetSubmissions(pluginRoot, { forFleetScale: true }),
      fleet_archive_detail: summarizeFleetArchiveEntries(listArchivedSubmissions(pluginRoot)),
    },
    submission_checklist: buildFleetConsumerChecklist({
      projectRoot,
      pluginRoot,
      muscleMemoryOk: muscleMemory.ok,
    }).steps,
  };
}

function main() {
  const pluginRoot = getDefaultPluginRoot();
  let projectRoot = pluginRoot;
  let outPath = null;
  const jsonStdout = process.argv.includes('--json');
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--project-root') projectRoot = path.resolve(process.argv[++i]);
    else if (a === '--out') outPath = path.resolve(process.argv[++i]);
  }

  const payload = collectFleetEvidence({ projectRoot, pluginRoot });
  const text = JSON.stringify(payload, null, 2);
  if (outPath) fs.writeFileSync(outPath, `${text}\n`);
  if (jsonStdout || !outPath) console.log(text);
  else console.log(`fleet-evidence-bundle: wrote ${outPath}`);
}

if (require.main === module) main();

module.exports = { collectFleetEvidence, buildSubmissionReadiness };
