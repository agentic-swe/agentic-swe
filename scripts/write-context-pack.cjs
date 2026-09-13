#!/usr/bin/env node
/**
 * Write a validated context-pack.json for a work item (includes muscle_memory).
 *
 * Usage:
 *   node scripts/write-context-pack.cjs --work-dir .worklogs/<id> [--plugin-root dir] [--json]
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { projectRootFromWorkDir } = require('./lib/work-engine/budget-config.cjs');
const { writeContextPack } = require('./lib/context/write-context-pack.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--work-dir') out.workDir = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.workDir) {
    console.error('write-context-pack requires --work-dir');
    process.exit(2);
  }
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const projectRoot = args.projectRoot || projectRootFromWorkDir(args.workDir);
  const r = writeContextPack({ workDir: args.workDir, pluginRoot, projectRoot });
  if (args.json) console.log(JSON.stringify(r, null, 2));
  else if (r.ok) console.log(`context-pack: wrote ${r.path} (${r.pack.muscle_memory?.length || 0} muscle memory rows)`);
  else {
    console.error('context-pack invalid', r.errors);
    process.exit(1);
  }
}

main();
