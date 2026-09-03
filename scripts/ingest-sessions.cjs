#!/usr/bin/env node
/**
 * Bulk-ingest chat/session JSONL transcripts into memory graph + chunks.
 *
 * Usage:
 *   node scripts/ingest-sessions.cjs [--project-root dir] [--dir path] [--json]
 *   node scripts/ingest-sessions.cjs --default-cursor [--json]
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { ingestTranscripts, findJsonlFiles } = require('./lib/memory/session-ingest.cjs');
const { discoverTranscriptSources } = require('./lib/memory/discover-transcripts.cjs');

function parseArgs(argv) {
  const out = { json: false, dirs: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--dir') out.dirs.push(path.resolve(argv[++i]));
    else if (a === '--default-cursor' || a === '--all-hosts') out.allHosts = true;
    else if (a === '--max-files') out.maxFiles = Number(argv[++i]);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = args.projectRoot || process.cwd();
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();

  let files = [];
  if (args.dirs.length) {
    for (const d of args.dirs) files.push(...findJsonlFiles(d));
  } else {
    files = discoverTranscriptSources(projectRoot, { allHosts: args.allHosts === true }).files;
  }

  const r = await ingestTranscripts({
    projectRoot,
    pluginRoot,
    transcriptPaths: files,
    maxFiles: args.maxFiles || 30,
  });

  if (args.json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`ingest-sessions: ${r.files} files → ${r.chunks} chunks, ${r.nodes} nodes`);
    console.log(`  sqlite: ${r.sqlitePath}`);
    if (r.redactionHits) console.log(`  redaction hits: ${r.redactionHits}, blocked turns: ${r.blocked}`);
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
