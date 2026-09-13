#!/usr/bin/env node
/**
 * Re-index archived fleet submissions into maintainer team memory graph.
 *
 * Usage:
 *   node scripts/fleet-sync-memory.cjs [--plugin-root dir] [--json]
 */
'use strict';

const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { syncArchivedFleetSubmissionsMemory } = require('./lib/fleet/ingest-fleet-memory.cjs');

async function main() {
  let pluginRoot = getDefaultPluginRoot();
  const json = process.argv.includes('--json');
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--plugin-root') pluginRoot = require('node:path').resolve(process.argv[++i]);
  }

  const r = await syncArchivedFleetSubmissionsMemory(pluginRoot);
  if (json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`fleet-sync-memory: ${r.synced}/${r.total} archives indexed`);
    if (r.errors?.length) {
      for (const e of r.errors) console.error(`  error ${e.archive}: ${e.error}`);
    }
  }
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
