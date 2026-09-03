#!/usr/bin/env node
/**
 * Mine verify commands from ingested session chunks → L1 descent candidates.
 *
 * Usage:
 *   node scripts/mine-session-procedures.cjs [--project-root dir] [--plugin-root dir] [--json]
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { mineSessionProcedures } = require('./lib/descent/mine-session-procedures.cjs');

async function main() {
  const args = { json: process.argv.includes('--json') };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--project-root') args.projectRoot = path.resolve(process.argv[++i]);
    else if (a === '--plugin-root') args.pluginRoot = path.resolve(process.argv[++i]);
  }
  const projectRoot = args.projectRoot || process.cwd();
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const r = await mineSessionProcedures({ projectRoot, pluginRoot });
  if (args.json) console.log(JSON.stringify(r, null, 2));
  else console.log(`mine-session-procedures: ${r.procedures} L1 candidates from ${r.mined} commands`);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
