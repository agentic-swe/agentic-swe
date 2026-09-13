#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { projectRootFromWorkDir } = require('./lib/work-engine/budget-config.cjs');
const { runDescentOnValidationApproval } = require('./lib/descent/validation-descent.cjs');

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

async function main() {
  const args = parseArgs(process.argv);
  if (!args.workDir) {
    console.error('validation-descent requires --work-dir');
    process.exit(2);
  }
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const projectRoot = args.projectRoot || projectRootFromWorkDir(args.workDir);
  const r = await runDescentOnValidationApproval({
    workDir: args.workDir,
    pluginRoot,
    projectRoot,
  });
  if (args.json) console.log(JSON.stringify(r, null, 2));
  else if (r.ok) console.log('DESCENT', r.tier, r.verifyCommand);
  else console.log('SKIP', r.reason || r.tier);
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
