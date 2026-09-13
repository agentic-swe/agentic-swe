#!/usr/bin/env node
/**
 * Descent-first corpus benchmark — measures L0 hit rate and frontier token attribution.
 *
 * Usage:
 *   node scripts/bench/run-descent.cjs [--seed] [--out bench/results/descent-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { seedCorpusProcedures } = require('../lib/descent/corpus-seed.cjs');
const { runCorpusDescentBench } = require('../lib/descent/try-descent.cjs');

function main() {
  const pluginRoot = getDefaultPluginRoot();
  const projectRoot = process.cwd();
  const seed = process.argv.includes('--seed');
  const outIdx = process.argv.indexOf('--out');
  const date = new Date().toISOString().slice(0, 10);
  const outPath =
    outIdx >= 0 ? process.argv[outIdx + 1] : path.join(pluginRoot, 'bench', 'results', `descent-${date}.json`);

  if (seed) {
    const s = seedCorpusProcedures({ pluginRoot, projectRoot: pluginRoot });
    console.log(`seeded ${s.seeded} L0 procedures`);
  }

  const r = runCorpusDescentBench({ pluginRoot, projectRoot: pluginRoot });
  const payload = { generated_at: new Date().toISOString(), ...r };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  console.log(`descent-bench: wrote ${outPath}`);
  console.log(
    `  L0 hits: ${r.summary.l0_hits}/${r.summary.total} (${(r.summary.l0_hit_rate * 100).toFixed(1)}%)`
  );
  console.log(
    `  frontier tokens (delivered): ${r.summary.frontier_tokens_total} vs cold est ${r.summary.frontier_tokens_cold_estimate} (${(r.summary.portfolio_multiplier * 100).toFixed(1)}%)`
  );
}

main();
