#!/usr/bin/env node
/**
 * Learning-curve benchmark: measure holdout token reduction as procedures accumulate.
 *
 * Simulates production learning by incrementally seeding holdout task procedures
 * (as if validation-approved captures) after an oracle-only cold start.
 *
 * Usage:
 *   node scripts/bench/run-descent-learning-curve.cjs [--out bench/results/descent-learning-curve-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { seedCorpusProcedures } = require('../lib/descent/corpus-seed.cjs');
const { tryDescent } = require('../lib/descent/try-descent.cjs');
const { runTaskAcceptance } = require('../lib/bench/run-task.cjs');
const { captureHoldoutFromValidation } = require('../lib/descent/holdout-capture.cjs');
const { DEFAULT_STORE } = require('../lib/descent/promotion.cjs');

const SEED_PREFIX = 'oracle-';
const HOLDOUT_PREFIXES = ['ritual-', 'mined-'];
const COLD_TOKENS_PER_TASK = 200000;
const TARGET_MULTIPLIER = 0.02;

function isHoldout(name) {
  return HOLDOUT_PREFIXES.some((p) => name.startsWith(p));
}

function measureHoldout(pluginRoot, storeRoot) {
  const corpusRoot = path.join(pluginRoot, 'bench', 'corpus');
  const tasks = [];
  for (const name of fs.readdirSync(corpusRoot)) {
    if (!isHoldout(name)) continue;
    const taskDir = path.join(corpusRoot, name);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    if (!fs.existsSync(path.join(taskDir, 'scoring.json'))) continue;
    const acceptance = runTaskAcceptance(taskDir);
    const scoring = JSON.parse(fs.readFileSync(path.join(taskDir, 'scoring.json'), 'utf8'));
    const verify = scoring.task_pass?.command || '';
    const descent = tryDescent({ projectRoot: storeRoot, verifyCommand: verify, files: [name] });
    const l0Hit = descent.ok === true;
    tasks.push({
      id: name,
      l0_hit: l0Hit,
      delivered: acceptance.ok,
      frontier_tokens: l0Hit ? 0 : COLD_TOKENS_PER_TASK,
    });
  }
  const delivered = tasks.filter((t) => t.delivered);
  const l0Hits = delivered.filter((t) => t.l0_hit).length;
  const deliveredFrontier = delivered.reduce((s, t) => s + t.frontier_tokens, 0);
  const coldFrontier = tasks.length * COLD_TOKENS_PER_TASK;
  const portfolioMultiplier = coldFrontier ? deliveredFrontier / coldFrontier : 1;
  return {
    tasks,
    summary: {
      holdout_total: tasks.length,
      delivered: delivered.length,
      l0_hits: l0Hits,
      l0_hit_rate_delivered: delivered.length ? l0Hits / delivered.length : 0,
      frontier_tokens_total: deliveredFrontier,
      portfolio_multiplier: portfolioMultiplier,
    },
  };
}

function simulateCapture(pluginRoot, storeRoot, taskName) {
  const r = captureHoldoutFromValidation({
    pluginRoot,
    projectRoot: storeRoot,
    taskName,
    humanApproved: true,
  });
  return r.ok;
}

function projectIterationsToTarget(curve) {
  const last = curve[curve.length - 1];
  if (!last || last.portfolio_multiplier <= TARGET_MULTIPLIER) {
    return { iterations_needed: 0, achievable: true };
  }
  if (curve.length < 2) {
    return { iterations_needed: null, achievable: false, reason: 'insufficient curve points' };
  }
  const p0 = curve[0].portfolio_multiplier;
  const pn = last.portfolio_multiplier;
  const n = curve.length - 1;
  const delta = p0 - pn;
  if (delta <= 0) {
    return { iterations_needed: null, achievable: false, reason: 'no improvement slope' };
  }
  const perIter = delta / n;
  const remaining = pn - TARGET_MULTIPLIER;
  const extra = Math.ceil(remaining / perIter);
  return { iterations_needed: n + extra, achievable: true, per_iteration_delta: perIter };
}

function main() {
  const pluginRoot = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `descent-learning-curve-${date}.json`);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'descent-curve-'));
  const storePath = path.join(tmpRoot, DEFAULT_STORE);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({ procedures: [] }, null, 2));

  seedCorpusProcedures({
    pluginRoot,
    projectRoot: tmpRoot,
    include: (name) => name.startsWith(SEED_PREFIX),
  });

  const curve = [];
  const baseline = measureHoldout(pluginRoot, tmpRoot);
  curve.push({
    iteration: 0,
    label: 'oracle-seed-only',
    ...baseline.summary,
    target_met: baseline.summary.portfolio_multiplier <= TARGET_MULTIPLIER,
  });

  const holdoutNames = baseline.tasks.map((t) => t.id);
  for (let i = 0; i < holdoutNames.length; i++) {
    simulateCapture(pluginRoot, tmpRoot, holdoutNames[i]);
    const m = measureHoldout(pluginRoot, tmpRoot);
    curve.push({
      iteration: i + 1,
      label: `+capture-${holdoutNames[i]}`,
      captured_task: holdoutNames[i],
      ...m.summary,
      target_met: m.summary.portfolio_multiplier <= TARGET_MULTIPLIER,
    });
  }

  const projection = projectIterationsToTarget(curve);
  const payload = {
    generated_at: new Date().toISOString(),
    ok: true,
    measurement_contract:
      'Incremental holdout capture simulation after oracle-only seed; models production procedure accumulation',
    target_multiplier: TARGET_MULTIPLIER,
    curve,
    projection,
    honesty:
      'Curve simulates validation-approved captures on holdout tasks; real production path requires work-engine descent-capture after approved validation',
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  const final = curve[curve.length - 1];
  console.log(`descent-learning-curve: wrote ${outPath}`);
  console.log(
    `  iteration 0: ${(curve[0].portfolio_multiplier * 100).toFixed(1)}% of cold → final ${(final.portfolio_multiplier * 100).toFixed(1)}%`
  );
  console.log(`  1-2% target met at iteration: ${curve.findIndex((c) => c.target_met)}`);
  if (projection.iterations_needed != null) {
    console.log(`  projected iterations to 1-2%: ${projection.iterations_needed}`);
  }
}

main();
