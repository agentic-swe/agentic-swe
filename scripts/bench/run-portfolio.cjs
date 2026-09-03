#!/usr/bin/env node
/**
 * Production portfolio benchmark — live procedure store + full descent ladder.
 *
 * Usage:
 *   node scripts/bench/run-portfolio.cjs [--out bench/results/portfolio-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { tryDescentLadder, loadTierTokenEstimates } = require('../lib/descent/ladder.cjs');
const { runTaskAcceptance } = require('../lib/bench/run-task.cjs');
const { aggregateProductionTierTotals, productionPortfolioMultiplier } = require('../lib/bench/production-tier-totals.cjs');

const HOLDOUT_PREFIXES = ['ritual-', 'mined-'];
const TARGET_MULTIPLIER = 0.02;
const MIN_HOLDOUT_DELIVERED_FOR_CLAIM = 3;
const MIN_PRODUCTION_WORK_ITEMS = 1;
const MIN_LIVE_WORK_ITEMS = 1;

function isHoldout(name) {
  return HOLDOUT_PREFIXES.some((p) => name.startsWith(p));
}

async function measureCorpus(pluginRoot, storeRoot, filter) {
  const corpusRoot = path.join(pluginRoot, 'bench', 'corpus');
  const tasks = [];
  for (const name of fs.readdirSync(corpusRoot)) {
    if (filter && !filter(name)) continue;
    const taskDir = path.join(corpusRoot, name);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    if (!fs.existsSync(path.join(taskDir, 'scoring.json'))) continue;

    const acceptance = runTaskAcceptance(taskDir);
    const scoring = JSON.parse(fs.readFileSync(path.join(taskDir, 'scoring.json'), 'utf8'));
    const verify = scoring.task_pass?.command || '';
    const cwd = scoring.task_pass?.cwd
      ? path.resolve(taskDir, scoring.task_pass.cwd)
      : taskDir;

    const descent = await tryDescentLadder({
      projectRoot: storeRoot,
      pluginRoot,
      verifyCommand: verify,
      files: [name],
      cwd,
    });

    const delivered = acceptance.ok;
    const hit = descent.ok === true;
    const tokens = delivered ? descent.delivered_tokens ?? descent.frontier_tokens : descent.frontier_tokens;

    tasks.push({
      id: name,
      delivered,
      ladder_hit: hit,
      tier: descent.tier,
      delivered_tokens: tokens,
      descent,
    });
  }

  const deliveredTasks = tasks.filter((t) => t.delivered);
  const totalDeliveredTokens = deliveredTasks.reduce((s, t) => s + (t.delivered_tokens || 0), 0);
  const coldPerDelivered = loadTierTokenEstimates(pluginRoot).L3;

  return {
    tasks,
    summary: {
      total: tasks.length,
      delivered: deliveredTasks.length,
      ladder_hits: deliveredTasks.filter((t) => t.ladder_hit).length,
      delivered_tokens_total: totalDeliveredTokens,
      cold_tokens_per_delivered: coldPerDelivered,
      cold_tokens_total: tasks.length * coldPerDelivered,
      portfolio_multiplier: tasks.length * coldPerDelivered
        ? totalDeliveredTokens / (tasks.length * coldPerDelivered)
        : 1,
      l0_l1_l2_breakdown: deliveredTasks.reduce((acc, t) => {
        const tier = t.tier || 'L3';
        acc[tier] = (acc[tier] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

async function main() {
  const pluginRoot = getDefaultPluginRoot();
  const storeRoot = pluginRoot;
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `portfolio-${date}.json`);

  const phase1Path = path.join(pluginRoot, 'bench/results/phase1-2026-08-29.json');
  const phase1 = fs.existsSync(phase1Path)
    ? JSON.parse(fs.readFileSync(phase1Path, 'utf8'))
    : { estimated_tokens_before: 7700, estimated_tokens_after: 1750 };

  const holdout = await measureCorpus(pluginRoot, storeRoot, isHoldout);
  const full = await measureCorpus(pluginRoot, storeRoot, null);

  const coldPolicy = phase1.estimated_tokens_before || 7700;
  const warmPolicy = phase1.estimated_tokens_after || 1750;

  const warmPortfolio =
    warmPolicy +
    holdout.summary.delivered_tokens_total / Math.max(1, holdout.summary.delivered);
  const coldPortfolio =
    coldPolicy + holdout.summary.cold_tokens_per_delivered;

  const combinedMultiplier = warmPortfolio / coldPortfolio;
  const production = aggregateProductionTierTotals(storeRoot);
  const prodPortfolio = productionPortfolioMultiplier(production, {
    policyCold: coldPolicy,
    policyWarm: warmPolicy,
  });
  const holdoutCoverageOk = holdout.summary.delivered >= MIN_HOLDOUT_DELIVERED_FOR_CLAIM;
  const liveWorkItems = production.sources?.live ?? 0;
  const fixtureWorkItems = production.sources?.fixtures ?? 0;
  const productionMultiplierOk = prodPortfolio.portfolio_multiplier <= TARGET_MULTIPLIER;
  const liveProductionVerified =
    liveWorkItems >= MIN_LIVE_WORK_ITEMS && productionMultiplierOk;
  const e2eProductionVerified =
    production.work_items >= MIN_PRODUCTION_WORK_ITEMS &&
    fixtureWorkItems >= MIN_PRODUCTION_WORK_ITEMS &&
    productionMultiplierOk;
  const benchTargetMet = holdoutCoverageOk && combinedMultiplier <= TARGET_MULTIPLIER;
  const targetMet = benchTargetMet && liveProductionVerified;
  let claimStatus = 'not_proven_at_scale';
  if (benchTargetMet && liveProductionVerified) claimStatus = 'proven_at_scale';
  else if (benchTargetMet && e2eProductionVerified) claimStatus = 'proven_e2e_bench';

  const payload = {
    generated_at: new Date().toISOString(),
    ok: true,
    measurement_contract:
      'Live .agentic-swe/procedures.json + full L0-L3 ladder; tier token estimates from config/descent.default.json',
    store: path.join(storeRoot, '.agentic-swe/procedures.json'),
    holdout,
    full_corpus: full.summary,
    production_tier_totals: production,
    production_portfolio: prodPortfolio,
    combined: {
      cold_per_task_tokens: coldPortfolio,
      warm_per_task_tokens: warmPortfolio,
      portfolio_multiplier: combinedMultiplier,
      target_multiplier: TARGET_MULTIPLIER,
      min_holdout_delivered_for_claim: MIN_HOLDOUT_DELIVERED_FOR_CLAIM,
      holdout_delivered: holdout.summary.delivered,
      holdout_coverage_ok: holdoutCoverageOk,
      live_work_items: liveWorkItems,
      fixture_work_items: fixtureWorkItems,
      production_work_items: production.work_items,
      production_verified: liveProductionVerified || e2eProductionVerified,
      live_production_verified: liveProductionVerified,
      e2e_production_verified: e2eProductionVerified,
      production_portfolio_multiplier: prodPortfolio.portfolio_multiplier,
      bench_target_met: benchTargetMet,
      target_met: targetMet,
      claim_status: claimStatus,
    },
    honesty: !holdoutCoverageOk
      ? `Portfolio target requires ${MIN_HOLDOUT_DELIVERED_FOR_CLAIM}+ holdout delivered tasks; have ${holdout.summary.delivered}`
      : !benchTargetMet
        ? `Holdout coverage ok (${holdout.summary.delivered}) but combined portfolio ${(combinedMultiplier * 100).toFixed(1)}% > ${TARGET_MULTIPLIER * 100}% target`
        : claimStatus === 'proven_at_scale'
          ? 'Live production tier_totals and bench holdout meet measurement contract'
          : claimStatus === 'proven_e2e_bench'
            ? `Bench + E2E fixtures verified (${(combinedMultiplier * 100).toFixed(1)}%); live team .worklogs pending for proven_at_scale`
            : `Bench holdout target met (${(combinedMultiplier * 100).toFixed(1)}%) but production tier_totals unverified (${production.work_items} work items)`,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`portfolio-bench: wrote ${outPath}`);
  console.log(
    `  holdout ladder hits: ${holdout.summary.ladder_hits}/${holdout.summary.delivered} delivered`
  );
  console.log(
    `  holdout frontier portfolio: ${(holdout.summary.portfolio_multiplier * 100).toFixed(1)}% of cold`
  );
  console.log(
    `  combined per-task: ${coldPortfolio.toFixed(0)} cold → ${warmPortfolio.toFixed(0)} warm (${((warmPortfolio / coldPortfolio) * 100).toFixed(1)}%)`
  );
  console.log(`  1-2% target met: ${payload.combined.target_met}`);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
