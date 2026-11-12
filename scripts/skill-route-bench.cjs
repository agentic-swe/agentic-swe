#!/usr/bin/env node
/**
 * AE-026b offline skill-routing accuracy benchmark.
 *
 * Usage:
 *   node scripts/skill-route-bench.cjs [--json] [--fixture path] [--plugin-root dir]
 *
 * Exit 0 when hit@k / precision / recall meet config/skill-routing-benchmark.json
 * thresholds; exit 1 on failure or corrupt fixture. Never calls paid LLMs (PD-9).
 */
'use strict';

const path = require('node:path');
const {
  runRoutingBenchmark,
  formatBenchmarkReport,
} = require('./lib/skills/routing-benchmark.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--fixture') out.fixturePath = path.resolve(argv[++i] || '');
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i] || '');
    else if (a === '--help' || a === '-h') out.help = true;
    else {
      console.error(`Unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(
      'Usage: skill-route-bench.cjs [--json] [--fixture path] [--plugin-root dir]'
    );
    process.exit(0);
  }
  if (args.fixturePath !== undefined && !args.fixturePath) {
    console.error('--fixture requires a path');
    process.exit(2);
  }
  if (args.pluginRoot !== undefined && !args.pluginRoot) {
    console.error('--plugin-root requires a path');
    process.exit(2);
  }

  const pluginRoot = args.pluginRoot || path.resolve(__dirname, '..');
  let report;
  try {
    report = runRoutingBenchmark({
      pluginRoot,
      fixturePath: args.fixturePath,
    });
  } catch (err) {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
  }

  console.log(formatBenchmarkReport(report, { json: args.json }));
  process.exit(report.pass ? 0 : 1);
}

main();
