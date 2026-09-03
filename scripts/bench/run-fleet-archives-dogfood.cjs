#!/usr/bin/env node
/**
 * Maintainer dogfood fleet archives bench — proves multi-consumer archive path
 * without counting toward fleet-scale-independent (all maintainer_dogfood).
 *
 * Usage:
 *   node scripts/bench/run-fleet-archives-dogfood.cjs [--out bench/results/fleet-archives-dogfood-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { summarizeFleetSubmissions, listArchivedSubmissions } = require('../ingest-fleet-submission.cjs');
const { summarizeFleetArchiveEntries } = require('../lib/fleet/archive-summaries.cjs');

function main() {
  const pluginRoot = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `fleet-archives-dogfood-${date}.json`);

  const all = summarizeFleetSubmissions(pluginRoot);
  const scale = summarizeFleetSubmissions(pluginRoot, { forFleetScale: true });
  const detail = summarizeFleetArchiveEntries(listArchivedSubmissions(pluginRoot));

  const payload = {
    generated_at: new Date().toISOString(),
    ok: all.archived >= 3 && detail.maintainer_dogfood_count >= 3,
    measurement_contract:
      'Pack-root archived maintainer_dogfood submissions prove multi-consumer ingest pipeline — excluded from fleet-scale-independent.',
    archived_total: all.archived,
    distinct_consumers: all.distinct_consumers,
    independent_consumers: scale.distinct_independent_consumers,
    maintainer_dogfood: detail.maintainer_dogfood_count,
    fleet_scale_met: detail.fleet_scale_met,
    entries: detail.entries,
    target_met: all.archived >= 3 && detail.maintainer_dogfood_count >= 3,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`fleet-archives-dogfood: wrote ${outPath}`);
  console.log(
    `  archived=${payload.archived_total} independent=${payload.independent_consumers} dogfood=${payload.maintainer_dogfood}`
  );
  process.exit(payload.ok ? 0 : 1);
}

main();
