#!/usr/bin/env node
/**
 * Publish token-reduction scorecard (measurement contract — honest, evidence-based).
 *
 * Usage:
 *   node scripts/bench/token-scorecard.cjs [--out bench/results/token-reduction-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { frontierTokenTotal } = require('../lib/bench/tier-totals.cjs');
const { aggregateProductionTierTotals } = require('../lib/bench/production-tier-totals.cjs');
const { tierHitRates } = require('../lib/descent/promotion.cjs');
const { loadGoldenEvalMap, runAllGoldenEvals } = require('../lib/skills/golden-eval.cjs');

const root = path.join(__dirname, '..', '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function latestJson(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort();
  if (!files.length) return null;
  return readJson(path.join(dir, files[files.length - 1]));
}

function countEvaluatedSkills() {
  const skillsRoot = path.join(root, 'skills');
  let evaluated = 0;
  let unevaluated = 0;
  for (const d of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const skillPath = path.join(skillsRoot, d.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    const raw = fs.readFileSync(skillPath, 'utf8');
    if (/eval_status:\s*"evaluated"/.test(raw)) evaluated++;
    else unevaluated++;
  }
  return { evaluated, unevaluated, total: evaluated + unevaluated };
}

function main() {
  const date = new Date().toISOString().slice(0, 10);
  const outArg = process.argv.indexOf('--out');
  const outPath =
    outArg >= 0 ? process.argv[outArg + 1] : path.join(root, 'bench', 'results', `token-reduction-${date}.json`);

  const phase1Path = path.join(root, 'bench', 'results', 'phase1-2026-08-29.json');
  const corpusPath = path.join(root, 'bench', 'results', 'baseline-corpus-2026-08-29.json');
  const phase1 = fs.existsSync(phase1Path) ? readJson(phase1Path) : null;
  const corpus = fs.existsSync(corpusPath) ? readJson(corpusPath) : null;

  const skillCounts = countEvaluatedSkills();
  const golden = runAllGoldenEvals({ pluginRoot: root, promote: false });
  const tierRates = tierHitRates(root);

  const descentPath = path.join(root, 'bench', 'results', `descent-${date}.json`);
  const holdoutPath = path.join(root, 'bench', 'results', `descent-holdout-${date}.json`);
  const descentMeasured = fs.existsSync(descentPath) ? readJson(descentPath).summary : null;
  const holdoutMeasured = fs.existsSync(holdoutPath) ? readJson(holdoutPath).summary : null;
  const learningPath = path.join(root, 'bench', 'results', `descent-learning-curve-${date}.json`);
  const portfolioPath = path.join(root, 'bench', 'results', `portfolio-${date}.json`);
  const learningCurve = fs.existsSync(learningPath) ? readJson(learningPath) : null;
  const portfolioMeasured = fs.existsSync(portfolioPath) ? readJson(portfolioPath) : null;
  const productionTotals = aggregateProductionTierTotals(root);
  const organicPortfolio = latestJson(path.join(root, 'bench', 'results'), 'organic-portfolio-');
  const claimStatus =
    portfolioMeasured?.combined?.claim_status ??
    (portfolioMeasured?.combined?.target_met ? 'proven_at_scale' : 'not_proven_at_scale');
  const corpusCircular =
    descentMeasured &&
    descentMeasured.l0_hit_rate_delivered >= 0.99 &&
    descentMeasured.frontier_tokens_total === 0;

  const fixedOverheadBefore = phase1?.estimated_tokens_before ?? 7700;
  const fixedOverheadAfter = phase1?.estimated_tokens_after ?? 1750;
  const fixedReductionPct = 1 - fixedOverheadAfter / fixedOverheadBefore;

  const delivered = corpus?.summary?.delivered ?? corpus?.tasks?.filter((t) => t.delivered).length ?? 0;
  const totalTasks = corpus?.summary?.total ?? corpus?.tasks?.length ?? 0;
  const passRate = corpus?.summary?.pass_rate ?? (totalTasks ? delivered / totalTasks : 0);

  const scorecard = {
    generated_at: new Date().toISOString(),
    measurement_contract: {
      headline_metric: 'median frontier-tier (L3) tokens per delivered unit on corpus (cold vs warm)',
      fixed_overhead_metric: 'session-start policy tokens (CLAUDE.md core)',
      honesty:
        '1-2% warm-portfolio target is ladder tokens vs L3 estimates. Organic session_usd_multiplier is billed verify-replay vs historical cost_used — not a new-feature session.',
    },
    fixed_overhead: {
      tokens_before: fixedOverheadBefore,
      tokens_after: fixedOverheadAfter,
      reduction_ratio: Number(fixedReductionPct.toFixed(4)),
      claude_md_bytes_before: phase1?.claude_md_bytes_before,
      claude_md_bytes_after: phase1?.claude_md_bytes_after,
    },
    corpus: {
      delivered,
      total: totalTasks,
      pass_rate: passRate,
      ref: path.relative(root, corpusPath),
    },
    skills: {
      ...skillCounts,
      golden_eval_passed: golden.passed,
      golden_eval_total: golden.total,
    },
    descent_ladder: {
      procedure_tiers: tierRates,
      L0_mechanisms: ['repo-map query', 'recorded procedure replay', 'engine transition', 'lint/test oracle'],
      corpus_measured: descentMeasured,
      holdout_measured: holdoutMeasured,
      learning_curve: learningCurve
        ? {
            final_multiplier: learningCurve.curve?.[learningCurve.curve.length - 1]?.portfolio_multiplier,
            projection: learningCurve.projection,
            target_met_at_iteration: learningCurve.curve?.findIndex((c) => c.target_met),
          }
        : null,
      corpus_circular_benchmark: corpusCircular,
    },
    warm_portfolio_projection: {
      status: portfolioMeasured?.combined?.claim_status === 'proven_at_scale'
        ? 'portfolio_target_met'
        : portfolioMeasured?.combined?.claim_status === 'proven_e2e_bench'
          ? 'e2e_bench_verified'
          : portfolioMeasured?.combined?.bench_target_met
            ? 'bench_target_met_live_unverified'
            : holdoutMeasured
            ? 'holdout_measured'
            : corpusCircular
              ? 'corpus_oracle_only'
              : 'framework_ready',
      current_estimated_multiplier:
        portfolioMeasured?.combined?.portfolio_multiplier ??
        holdoutMeasured?.portfolio_multiplier ??
        (descentMeasured ? descentMeasured.portfolio_multiplier : fixedOverheadAfter / fixedOverheadBefore),
      l0_hit_rate_delivered:
        portfolioMeasured?.holdout?.summary?.ladder_hits != null && portfolioMeasured?.holdout?.summary?.delivered
          ? portfolioMeasured.holdout.summary.ladder_hits / portfolioMeasured.holdout.summary.delivered
          : holdoutMeasured?.l0_hit_rate_delivered ?? descentMeasured?.l0_hit_rate_delivered ?? null,
      combined_per_task: portfolioMeasured?.combined ?? null,
      claim_status: claimStatus,
      production_tier_totals: productionTotals,
      organic_portfolio: organicPortfolio?.summary ?? null,
      note: portfolioMeasured?.honesty ?? (holdoutMeasured
        ? `Non-circular holdout: ${(holdoutMeasured.portfolio_multiplier * 100).toFixed(1)}% of cold frontier estimate — production accumulation still required for 1-2%`
        : corpusCircular
          ? '0 frontier tokens on delivered corpus tasks is circular (L0 seeded from same corpus); production accumulation still required'
          : 'Additional reduction requires L0/L1 hit-rate accumulation; publish curve in bench/results as data accrues'),
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(scorecard, null, 2));
  console.log(`token-scorecard: wrote ${outPath}`);
  console.log(
    `  fixed overhead: ${fixedOverheadBefore} → ${fixedOverheadAfter} tokens (${(fixedReductionPct * 100).toFixed(1)}% reduction)`
  );
  console.log(`  corpus pass rate: ${(passRate * 100).toFixed(1)}% (${delivered}/${totalTasks})`);
  console.log(`  evaluated skills: ${skillCounts.evaluated}/${skillCounts.total}`);
}

main();
