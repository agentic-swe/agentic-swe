#!/usr/bin/env node
/**
 * Warm vs cold token reduction model (measurement contract).
 *
 * Usage:
 *   node scripts/bench/warm-cold.cjs [--out bench/results/warm-cold-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { tierHitRates } = require('../lib/descent/promotion.cjs');
const { tierHitRatesFromTelemetry } = require('../lib/descent/tier-telemetry.cjs');

const root = path.join(__dirname, '..', '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

/** Estimated tokens per delivered corpus task under different memory states. */
function modelScenario(opts) {
  const {
    policyTokens,
    explorationTokens,
    reasoningTokens,
    verifyTokens,
    l0HitRate,
    l1HitRate,
  } = opts;

  const l0Savings = explorationTokens * l0HitRate;
  const l1Savings = reasoningTokens * l1HitRate;
  const total =
    policyTokens + explorationTokens + reasoningTokens + verifyTokens - l0Savings - l1Savings;
  return Math.max(verifyTokens, total);
}

function main() {
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(root, 'bench', 'results', `warm-cold-${date}.json`);

  const phase1 = fs.existsSync(path.join(root, 'bench/results/phase1-2026-08-29.json'))
    ? readJson(path.join(root, 'bench/results/phase1-2026-08-29.json'))
    : { estimated_tokens_before: 7700, estimated_tokens_after: 1750 };

  const procTiers = tierHitRates(root);
  const telem = tierHitRatesFromTelemetry(root);

  const descentPath = path.join(root, 'bench', 'results', `descent-${date}.json`);
  const holdoutPath = path.join(root, 'bench', 'results', `descent-holdout-${date}.json`);
  let descentMeasured = null;
  if (fs.existsSync(descentPath)) {
    descentMeasured = readJson(descentPath).summary;
  }
  let holdoutMeasured = null;
  if (fs.existsSync(holdoutPath)) {
    holdoutMeasured = readJson(holdoutPath).summary;
  }

  const coldPolicy = phase1.estimated_tokens_before || 7700;
  const warmPolicy = phase1.estimated_tokens_after || 1750;
  const perTaskExploration = 120000;
  const perTaskReasoning = 80000;
  const perTaskVerify = 5000;

  const l0HitRate = descentMeasured?.l0_hit_rate_delivered ?? Math.min(0.15, (procTiers.L0 || 0) / Math.max(1, procTiers.total || 1));

  const coldPerTask = modelScenario({
    policyTokens: coldPolicy,
    explorationTokens: perTaskExploration,
    reasoningTokens: perTaskReasoning,
    verifyTokens: perTaskVerify,
    l0HitRate: 0,
    l1HitRate: 0,
  });

  const warmPerTask = descentMeasured
    ? descentMeasured.median_frontier_per_delivered + warmPolicy
    : modelScenario({
        policyTokens: warmPolicy,
        explorationTokens: perTaskExploration,
        reasoningTokens: perTaskReasoning,
        verifyTokens: perTaskVerify,
        l0HitRate,
        l1HitRate: telem.L1 || 0,
      });

  const portfolioMultiplier = descentMeasured
    ? descentMeasured.portfolio_multiplier
    : warmPerTask / coldPerTask;
  const targetMultiplier = 0.02;
  const corpusCircular =
    descentMeasured &&
    descentMeasured.l0_hit_rate_delivered >= 0.99 &&
    descentMeasured.frontier_tokens_total === 0;
  const targetMet =
    !corpusCircular &&
    holdoutMeasured &&
    holdoutMeasured.portfolio_multiplier <= targetMultiplier;

  let honesty;
  if (corpusCircular) {
    honesty =
      'Corpus oracle replay: L0 procedures seeded from bench/corpus achieve 0 frontier tokens on delivered tasks — circular benchmark only; production SWE 1-2% target not yet proven';
  } else if (holdoutMeasured && holdoutMeasured.portfolio_multiplier > targetMultiplier) {
    honesty = `Holdout benchmark (non-circular): ${(holdoutMeasured.portfolio_multiplier * 100).toFixed(1)}% of cold — requires production L0 accumulation for 1-2% target`;
  } else if (portfolioMultiplier > targetMultiplier) {
    honesty =
      'Warm portfolio improves vs cold but 1-2% target not yet met — requires higher L0/L1 hit rates from production use';
  } else {
    honesty = 'Target range achieved in model';
  }

  const report = {
    generated_at: new Date().toISOString(),
    measurement_contract:
      'Modeled tokens per corpus-delivered unit; L0/L1 hit rates from procedure store + telemetry',
    cold: {
      policy_tokens: coldPolicy,
      modeled_per_task_tokens: coldPerTask,
      l0_hit_rate: 0,
      l1_hit_rate: 0,
    },
    warm: {
      policy_tokens: warmPolicy,
      modeled_per_task_tokens: warmPerTask,
      l0_procedures: procTiers,
      tier_telemetry: telem,
      descent_measured: descentMeasured,
      holdout_measured: holdoutMeasured,
    },
    reduction: {
      portfolio_multiplier: Number(portfolioMultiplier.toFixed(4)),
      percent_of_cold: Number((portfolioMultiplier * 100).toFixed(2)),
      target_multiplier: targetMultiplier,
      corpus_circular_benchmark: corpusCircular,
      target_met: targetMet,
      honesty,
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`warm-cold: wrote ${outPath}`);
  console.log(
    `  modeled per-task: cold=${coldPerTask} warm=${warmPerTask} (${(portfolioMultiplier * 100).toFixed(1)}% of cold)`
  );
  console.log(`  1-2% target met: ${report.reduction.target_met}`);
}

main();
