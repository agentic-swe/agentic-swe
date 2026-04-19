#!/usr/bin/env node
/**
 * Write a bounded markdown artifact under a work item (deterministic; no LLM).
 *
 * Usage:
 *   node scripts/memory-compact.cjs --work-dir /abs/.worklogs/<id> [--plugin-root <dir>] [--json]
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { writeCompactArtifact } = require('./lib/memory/memory-compact.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--work-dir') out.workDir = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.workDir) {
    console.error('memory-compact: required --work-dir <path-to-.worklogs/id>');
    process.exit(2);
  }
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const r = writeCompactArtifact({ workDirAbs: args.workDir, pluginRoot });
  if (args.json) {
    console.log(JSON.stringify({ ok: true, ...r }, null, 2));
    return;
  }
  console.log(`memory-compact: wrote ${r.outputPath}`);
  console.log(`  files: ${r.filesUsed.join(', ') || '(none)'}`);
}

main();
