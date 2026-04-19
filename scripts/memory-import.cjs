#!/usr/bin/env node
/**
 * Merge a validated JSON bundle into .agentic-swe/memory.sqlite (nodes + edges).
 *
 * Usage:
 *   node scripts/memory-import.cjs --project-root <dir> [--plugin-root <dir>] [--file bundle.json] [--json]
 *   cat bundle.json | node scripts/memory-import.cjs --project-root <dir>
 *
 * Requires import_adapter.enabled in merged memory config (unless --force).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { runMemoryImport } = require('./lib/memory/memory-import-apply.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--force') out.force = true;
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--file') out.file = path.resolve(argv[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = args.projectRoot || process.cwd();
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();

  let raw = '';
  if (args.file) {
    raw = fs.readFileSync(args.file, 'utf8');
  } else {
    raw = fs.readFileSync(0, 'utf8');
  }
  const bundle = JSON.parse(raw || '{}');

  const r = await runMemoryImport({ projectRoot, pluginRoot, bundle, force: args.force === true });
  if (args.json) {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
    return;
  }
  if (!r.ok) {
    console.error(`memory-import: ${r.code} — ${r.message}`);
    process.exit(1);
  }
  console.log(`memory-import: merged into ${r.sqlitePath}`);
  console.log(`  nodes: ${r.stats.nodes}  edges: ${r.stats.edges}`);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
