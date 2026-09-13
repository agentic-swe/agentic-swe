#!/usr/bin/env node
/**
 * Non-circular descent benchmark: seed L0 from oracle tasks only, measure holdout tasks.
 *
 * Usage:
 *   node scripts/bench/run-descent-holdout.cjs [--out bench/results/descent-holdout-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { seedCorpusProcedures } = require('../lib/descent/corpus-seed.cjs');
const { tryDescent } = require('../lib/descent/try-descent.cjs');
const { runTaskAcceptance } = require('../lib/bench/run-task.cjs');
const { DEFAULT_STORE } = require('../lib/descent/promotion.cjs');

const SEED_PREFIX = 'oracle-';
const HOLDOUT_PREFIXES = ['ritual-', 'mined-'];

function isHoldout(name) {
  return HOLDOUT_PREFIXES.some((p) => name.startsWith(p));
}

function isSeed(name) {
  return name.startsWith(SEED_PREFIX);
}

function main() {
  const pluginRoot = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `descent-holdout-${date}.json`);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'descent-holdout-'));
  const storePath = path.join(tmpRoot, DEFAULT_STORE);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({ procedures: [] }, null, 2));

  const seed = seedCorpusProcedures({
    pluginRoot,
    projectRoot: tmpRoot,
    include: isSeed,
  });

  const corpusRoot = path.join(pluginRoot, 'bench', 'corpus');
  const holdoutTasks = [];
  for (const name of fs.readdirSync(corpusRoot)) {
    if (!isHoldout(name)) continue;
    const taskDir = path.join(corpusRoot, name);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    if (!fs.existsSync(path.join(taskDir, 'scoring.json'))) continue;

    const acceptance = runTaskAcceptance(taskDir);
    const scoring = JSON.parse(fs.readFileSync(path.join(taskDir, 'scoring.json'), 'utf8'));
    const verify = scoring.task_pass?.command || '';
    const descent = tryDescent({ projectRoot: tmpRoot, verifyCommand: verify, files: [name] });
    const l0Hit = descent.ok === true;
    holdoutTasks.push({
      id: name,
      l0_hit: l0Hit,
      acceptance_ok: acceptance.ok,
      delivered: acceptance.ok,
      frontier_tokens: l0Hit ? 0 : 200000,
      descent,
    });
  }

  const delivered = holdoutTasks.filter((t) => t.delivered).length;
  const l0Hits = holdoutTasks.filter((t) => t.l0_hit && t.delivered).length;
  const deliveredFrontier = holdoutTasks.filter((t) => t.delivered).reduce((s, t) => s + t.frontier_tokens, 0);
  const coldFrontier = holdoutTasks.length * 200000;

  const payload = {
    generated_at: new Date().toISOString(),
    ok: true,
    measurement_contract:
      'Seed L0 from oracle-* corpus tasks only; evaluate ritual-* and mined-* holdout without circular seeding',
    seed: { tasks: seed.seeded, store: storePath },
    holdout: holdoutTasks,
    summary: {
      holdout_total: holdoutTasks.length,
      delivered,
      l0_hits: l0Hits,
      l0_hit_rate: holdoutTasks.length ? l0Hits / holdoutTasks.length : 0,
      l0_hit_rate_delivered: delivered ? l0Hits / delivered : 0,
      frontier_tokens_total: deliveredFrontier,
      frontier_tokens_cold_estimate: coldFrontier,
      portfolio_multiplier: coldFrontier ? deliveredFrontier / coldFrontier : 1,
      corpus_circular_benchmark: false,
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log(`descent-holdout: wrote ${outPath}`);
  console.log(`  seeded ${seed.seeded} oracle procedures (isolated store)`);
  console.log(
    `  holdout L0 hits: ${l0Hits}/${holdoutTasks.length} (${(payload.summary.l0_hit_rate * 100).toFixed(1)}%)`
  );
  console.log(
    `  holdout frontier tokens: ${deliveredFrontier} vs cold ${coldFrontier} (${(payload.summary.portfolio_multiplier * 100).toFixed(1)}%)`
  );
}

main();
