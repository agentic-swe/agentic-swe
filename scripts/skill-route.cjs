#!/usr/bin/env node
/**
 * Runtime skill discovery with eval_status flagging.
 *
 * Usage:
 *   node scripts/skill-route.cjs "implement retry logic" [--k 5] [--json]
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { routeSkillsWithMemory } = require('./lib/skills/skill-router.cjs');

function parseArgs(argv) {
  const out = { json: false, k: 5, queryParts: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--k') out.k = Number(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else out.queryParts.push(a);
  }
  out.query = out.queryParts.join(' ').trim();
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.query) {
    console.error('Usage: skill-route.cjs "<query>" [--k N] [--project-root dir] [--json]');
    process.exit(2);
  }
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const r = await routeSkillsWithMemory({
    pluginRoot,
    projectRoot: args.projectRoot || pluginRoot,
    query: args.query,
    k: args.k,
  });
  if (args.json) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  console.log(`# skill-route: ${JSON.stringify(args.query)}`);
  for (const row of r.results) {
    const flag = row.flag ? ` ⚠ ${row.flag}` : '';
    const boost = row.memory_boost ? ` +mem${row.memory_boost}` : '';
    console.log(`${row.score.toFixed(3)}  ${row.name}  [${row.eval_status}]${boost}${flag}`);
  }
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(1);
});
