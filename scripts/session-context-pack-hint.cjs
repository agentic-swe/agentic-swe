#!/usr/bin/env node
/**
 * Session-start: inject compact context-pack brief if the active work item has one.
 * Opt out: AGENTIC_SWE_CONTEXT_PACK_HINT=0
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { discoverActiveWorkDir } = require('./lib/work-engine/discover-workdir.cjs');
const { loadWorkContextPack, delegateBriefFromPack } = require('./lib/context/delegate-from-pack.cjs');

function parseArgs(argv) {
  const args = argv.slice(2);
  let projectRoot = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project-root' && args[i + 1]) {
      projectRoot = path.resolve(args[++i]);
    }
  }
  return { projectRoot };
}

function main() {
  if (['0', 'false', 'off'].includes(String(process.env.AGENTIC_SWE_CONTEXT_PACK_HINT || '').toLowerCase())) {
    return;
  }
  const { projectRoot } = parseArgs(process.argv);
  const workDir = process.env.AGENTIC_SWE_WORK_DIR
    ? path.resolve(process.env.AGENTIC_SWE_WORK_DIR)
    : discoverActiveWorkDir(projectRoot);
  if (!workDir || !fs.existsSync(path.join(workDir, 'state.json'))) return;
  const pack = loadWorkContextPack(workDir);
  if (!pack) return;
  const { markdown } = delegateBriefFromPack(pack);
  process.stdout.write(`${markdown}\n`);
}

main();
