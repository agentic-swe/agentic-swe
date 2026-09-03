#!/usr/bin/env node
/**
 * Callable memory search (session / personal / team scopes).
 *
 * Usage:
 *   node scripts/memory-search.cjs [--query "text"] [--scope session|personal|team] [--work-id id] [--json]
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { buildPrimeMarkdown } = require('./lib/memory/memory-prime.cjs');
const { resolvePrimeQuery } = require('./lib/memory/resolve-prime-query.cjs');
const { sqlitePathForScope } = require('./lib/memory/scopes.cjs');

function parseArgs(argv) {
  const out = { scope: 'session', json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--query') out.query = argv[++i];
    else if (a === '--work-id') out.workId = argv[++i];
    else if (a === '--scope') out.scope = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = args.projectRoot || process.cwd();
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const scope = ['session', 'personal', 'team'].includes(args.scope) ? args.scope : 'session';
  const sqlitePath = sqlitePathForScope(scope, { pluginRoot, projectRoot });
  const resolved = resolvePrimeQuery({
    projectRoot,
    query: args.query || (scope === 'personal' ? 'style profile' : scope === 'team' ? 'team' : null),
    workId: args.workId || null,
  });
  const filterWorkId = args.workId || (scope === 'team' ? 'team' : scope === 'personal' ? 'personal' : resolved.workId);

  const md = await buildPrimeMarkdown({
    projectRoot,
    pluginRoot,
    sqlitePath,
    query: resolved.query,
    workId: filterWorkId,
    querySource: resolved.source,
  });

  const payload = {
    ok: true,
    scope: args.scope,
    query: resolved.query,
    query_source: resolved.source,
    markdown: md,
  };
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(md);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
