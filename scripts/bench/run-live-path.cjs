#!/usr/bin/env node
/**
 * Isolated live-path benchmark: dogfood work-engine .worklogs in a temp project.
 * Does not write pack-root .worklogs (keeps proven_at_scale honest).
 *
 * Usage:
 *   node scripts/bench/run-live-path.cjs [--out bench/results/live-path-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');

function main() {
  const pluginRoot = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `live-path-${date}.json`);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live-path-'));
  const r = spawnSync(
    process.execPath,
    [path.join(pluginRoot, 'scripts/dogfood-live-worklogs.cjs'), '--project-root', tmpRoot, '--json'],
    { encoding: 'utf8', cwd: pluginRoot }
  );

  let dogfood = null;
  try {
    dogfood = JSON.parse(r.stdout);
  } catch {
    dogfood = { ok: false, parse_error: true, stdout: r.stdout, stderr: r.stderr };
  }

  const live = dogfood?.live_status || {};
  const payload = {
    generated_at: new Date().toISOString(),
    ok: r.status === 0 && dogfood?.ok === true,
    measurement_contract:
      'Isolated temp .worklogs via applyTransition; not pack-root live usage; does not by itself prove proven_at_scale',
    isolated_project: tmpRoot,
    runs: dogfood?.runs || [],
    live_work_items: live.live_work_items || 0,
    live_production_verified: live.live_production_verified === true,
    production_portfolio_multiplier: live.production_portfolio_multiplier,
    claim_status: live.claim_status || 'unknown',
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log(`live-path: wrote ${outPath}`);
  console.log(`  isolated live items: ${payload.live_work_items}, verified: ${payload.live_production_verified}`);
  process.exit(payload.ok ? 0 : 1);
}

main();
