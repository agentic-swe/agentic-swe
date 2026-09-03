#!/usr/bin/env node
/**
 * Deterministic repo symbol / import / test map (no ML).
 *
 * Usage:
 *   node scripts/repo-map.cjs [--root <dir>] [--json]
 *   node scripts/repo-map.cjs --symbol <name> [--root <dir>]
 *   node scripts/repo-map.cjs --imports-of <path> [--root <dir>]
 *   node scripts/repo-map.cjs --tests-for <path> [--root <dir>]
 */
'use strict';

const path = require('node:path');
const { buildRepoMap } = require('./lib/repo-map/build.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--root') out.root = path.resolve(argv[++i]);
    else if (a === '--symbol') out.symbol = argv[++i];
    else if (a === '--imports-of') out.importsOf = argv[++i];
    else if (a === '--tests-for') out.testsFor = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function usage() {
  console.log(`Usage:
  node scripts/repo-map.cjs [--root <dir>] [--json]
  node scripts/repo-map.cjs --symbol <name>
  node scripts/repo-map.cjs --imports-of <repo-relative-path>
  node scripts/repo-map.cjs --tests-for <repo-relative-path>`);
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }
  const root = args.root || process.cwd();
  const map = buildRepoMap(root);

  if (args.symbol) {
    const hits = map.symbolIndex.get(args.symbol) || [];
    if (args.json) {
      console.log(JSON.stringify({ symbol: args.symbol, files: hits }, null, 2));
      return;
    }
    console.log(`# symbol: ${args.symbol}`);
    for (const f of hits) console.log(f);
    return;
  }

  if (args.importsOf) {
    const norm = args.importsOf.replace(/\\/g, '/');
    const ent = map.files.find((f) => f.file === norm);
    const imports = ent ? ent.imports : [];
    if (args.json) {
      console.log(JSON.stringify({ file: norm, imports }, null, 2));
      return;
    }
    console.log(`# imports-of: ${norm}`);
    for (const f of imports) console.log(f);
    return;
  }

  if (args.testsFor) {
    const norm = args.testsFor.replace(/\\/g, '/');
    const tests = map.testsFor.get(norm) || [];
    if (args.json) {
      console.log(JSON.stringify({ file: norm, tests }, null, 2));
      return;
    }
    console.log(`# tests-for: ${norm}`);
    for (const f of tests) console.log(f);
    return;
  }

  const summary = {
    root,
    file_count: map.files.length,
    symbol_count: map.symbolIndex.size,
    files: map.files,
  };
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`# repo-map (${summary.file_count} files, ${summary.symbol_count} symbols)`);
  for (const f of map.files.slice(0, 200)) {
    console.log(`${f.file}  symbols=${f.symbols.length} imports=${f.imports.length}`);
  }
  if (map.files.length > 200) {
    console.log(`… (${map.files.length - 200} more; use --json for full output)`);
  }
}

main();
