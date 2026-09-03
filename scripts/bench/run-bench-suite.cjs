#!/usr/bin/env node
/**
 * Run full measurement bench suite and write manifest.
 *
 * Usage:
 *   node scripts/bench/run-bench-suite.cjs [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');

function runNode(script, extraArgs = []) {
  const r = spawnSync(process.execPath, [script, ...extraArgs], {
    encoding: 'utf8',
    cwd: getDefaultPluginRoot(),
  });
  return { ok: r.status === 0, status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function main() {
  const pluginRoot = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const resultsDir = path.join(pluginRoot, 'bench', 'results');
  fs.mkdirSync(resultsDir, { recursive: true });

  const steps = [
    { name: 'descent', script: 'scripts/bench/run-descent.cjs', out: `descent-${date}.json`, args: ['--seed'] },
    { name: 'holdout', script: 'scripts/bench/run-descent-holdout.cjs', out: `descent-holdout-${date}.json` },
    { name: 'learning-curve', script: 'scripts/bench/run-descent-learning-curve.cjs', out: `descent-learning-curve-${date}.json` },
    { name: 'accumulate-holdout', script: 'scripts/bench/accumulate-holdout-procedures.cjs' },
    { name: 'production-evidence', script: 'scripts/bench/run-production-evidence.cjs', out: `production-evidence-${date}.json`, args: ['--persist-fixtures'] },
    { name: 'dogfood-live', script: 'scripts/dogfood-live-worklogs.cjs', out: `dogfood-live-${date}.json` },
    { name: 'portfolio', script: 'scripts/bench/run-portfolio.cjs', out: `portfolio-${date}.json` },
    { name: 'organic-portfolio', script: 'scripts/bench/run-organic-portfolio.cjs', out: `organic-portfolio-${date}.json` },
    { name: 'production-sim', script: 'scripts/bench/run-production-sim.cjs', out: `production-sim-${date}.json` },
    { name: 'warm-cold', script: 'scripts/bench/warm-cold.cjs', out: `warm-cold-${date}.json` },
    { name: 'token-scorecard', script: 'scripts/bench/token-scorecard.cjs', out: `token-reduction-${date}.json` },
    { name: 'live-path', script: 'scripts/bench/run-live-path.cjs', out: `live-path-${date}.json` },
    { name: 'transcript-descent', script: 'scripts/bench/run-transcript-descent.cjs', out: `transcript-descent-${date}.json` },
    { name: 'implementation-entry', script: 'scripts/bench/run-implementation-entry.cjs', out: `implementation-entry-${date}.json` },
    { name: 'git-descent', script: 'scripts/bench/run-git-descent.cjs', out: `git-descent-${date}.json` },
    { name: 'git-pack-descent', script: 'scripts/bench/run-git-pack-descent.cjs', out: `git-pack-descent-${date}.json` },
    { name: 'organic-descent', script: 'scripts/bench/run-organic-descent.cjs', out: `organic-descent-${date}.json` },
    { name: 'session-mine-descent', script: 'scripts/bench/run-session-mine-descent.cjs', out: `session-mine-descent-${date}.json` },
    { name: 'consumer-repo-descent', script: 'scripts/bench/run-consumer-repo-descent.cjs', out: `consumer-repo-descent-${date}.json` },
    { name: 'consumer-fleet-readiness', script: 'scripts/bench/run-consumer-fleet-readiness.cjs', out: `consumer-fleet-readiness-${date}.json` },
    { name: 'fleet-archives-dogfood', script: 'scripts/bench/run-fleet-archives-dogfood.cjs', out: `fleet-archives-dogfood-${date}.json` },
    { name: 'fleet-scale-gate-fixture', script: 'scripts/bench/run-fleet-scale-gate-fixture.cjs', out: `fleet-scale-gate-fixture-${date}.json` },
    { name: 'objective-evidence', script: 'scripts/objective-evidence.cjs', out: `objective-evidence-${date}.json` },
  ];

  const manifest = { generated_at: new Date().toISOString(), ok: true, steps: [] };

  for (const step of steps) {
    const outPath = step.out ? path.join(resultsDir, step.out) : null;
    const args = [...(step.args || []), ...(outPath ? ['--out', outPath] : [])];
    const r = runNode(path.join(pluginRoot, step.script), args);
    manifest.steps.push({
      name: step.name,
      ok: r.ok,
      out: outPath ? path.relative(pluginRoot, outPath) : null,
      status: r.status,
    });
    if (!r.ok) {
      manifest.ok = false;
      if (r.stderr) process.stderr.write(r.stderr);
    }
  }

  const scorecardPath = path.join(resultsDir, `token-reduction-${date}.json`);
  if (fs.existsSync(scorecardPath)) {
    const sc = JSON.parse(fs.readFileSync(scorecardPath, 'utf8'));
    manifest.claim = {
      target_met: sc.warm_portfolio_projection?.combined_per_task?.target_met ?? false,
      claim_status: sc.warm_portfolio_projection?.combined_per_task?.claim_status ?? 'unknown',
      portfolio_multiplier: sc.warm_portfolio_projection?.current_estimated_multiplier,
    };
  }

  const manifestPath = path.join(resultsDir, `bench-suite-${date}.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(manifest, null, 2));
  } else {
    console.log(`bench-suite: wrote ${manifestPath}`);
    for (const s of manifest.steps) {
      console.log(`  ${s.ok ? 'OK' : 'FAIL'} ${s.name} → ${s.out}`);
    }
    if (manifest.claim) {
      console.log(`  claim_status: ${manifest.claim.claim_status}`);
    }
  }

  process.exit(manifest.ok ? 0 : 1);
}

main();
