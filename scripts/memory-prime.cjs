#!/usr/bin/env node
/**
 * Emit a bounded markdown "memory prime" block: graph digest + optional chunk hits (lexical / semantic / hybrid per config).
 *
 * Usage:
 *   node scripts/memory-prime.cjs [--project-root <dir>] [--plugin-root <dir>] [--query "terms"] [--work-id <id>]
 * Env: AGENTIC_SWE_MEMORY_PRIME_QUERY — default search terms when --query omitted.
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { buildPrimeMarkdown } = require('./lib/memory/memory-prime.cjs');
const { resolvePrimeQuery } = require('./lib/memory/resolve-prime-query.cjs');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--query') out.query = argv[++i];
    else if (a === '--work-id') out.workId = argv[++i];
    else if (a === '--json') out.json = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = args.projectRoot || process.cwd();
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const resolved = resolvePrimeQuery({
    projectRoot,
    query: args.query != null ? args.query : null,
    workId: args.workId || null,
  });

  const md = await buildPrimeMarkdown({
    projectRoot,
    pluginRoot,
    query: resolved.query,
    workId: resolved.workId,
    querySource: resolved.source,
  });

  if (args.json) {
    console.log(JSON.stringify({ ok: true, markdown: md }, null, 2));
    return;
  }
  console.log(md);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
