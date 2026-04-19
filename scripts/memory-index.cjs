#!/usr/bin/env node
/**
 * Build / refresh the local deterministic project graph + chunked FTS (SQLite) for Phase 2 memory.
 *
 * Usage:
 *   node scripts/memory-index.cjs [--project-root <dir>] [--plugin-root <dir>] [--graph-only] [--chunks-only] [--json]
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { runMemoryIndex } = require('./lib/memory/memory-pipeline.cjs');
const { queryGraphStats } = require('./lib/memory/graph-query.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--graph-only') out.graphOnly = true;
    else if (a === '--chunks-only') out.chunksOnly = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = args.projectRoot || process.cwd();
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();

  const skipGraph = args.chunksOnly === true;
  const skipChunks = args.graphOnly === true;
  if (args.graphOnly && args.chunksOnly) {
    console.error('memory-index: specify at most one of --graph-only / --chunks-only');
    process.exit(2);
  }

  const r = await runMemoryIndex({ projectRoot, pluginRoot, skipGraph, skipChunks });
  const stats = await queryGraphStats(r.sqlitePath);

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          sqlitePath: r.sqlitePath,
          ingest: r.stats,
          query: stats,
          graphSkipped: r.graphSkipped,
          chunksSkipped: r.chunksSkipped,
        },
        null,
        2
      )
    );
    return;
  }

  console.log(`memory-index: wrote ${r.sqlitePath}`);
  const emb = r.stats.embedded != null ? r.stats.embedded : 0;
  console.log(
    `  nodes: ${stats.nodes}  edges: ${stats.edges}  chunks indexed: ${r.stats.chunks}  embeddings: ${emb}`
  );
  if (r.stats.embedError) {
    console.log(`  embedding sync warning: ${r.stats.embedError}`);
  }
  if (stats.kinds && stats.kinds.nodes) {
    console.log(`  node kinds: ${JSON.stringify(stats.kinds.nodes)}`);
  }
  if (stats.kinds && stats.kinds.edges) {
    console.log(`  edge kinds: ${JSON.stringify(stats.kinds.edges)}`);
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
