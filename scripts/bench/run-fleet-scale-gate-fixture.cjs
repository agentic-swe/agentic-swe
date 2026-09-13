#!/usr/bin/env node
/**
 * Isolated fixture proving fleet-scale gate mechanics (tmp archives only).
 * Does not modify pack archives or count as real fleet traffic.
 *
 * Usage:
 *   node scripts/bench/run-fleet-scale-gate-fixture.cjs [--out bench/results/fleet-scale-gate-fixture-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evaluateFleetScaleGate } = require('../lib/fleet/fleet-scale-gate.cjs');

function writeArchive(pluginRoot, consumerRoot, idx) {
  const dir = path.join(pluginRoot, 'bench', 'results', 'fleet-submissions');
  fs.mkdirSync(dir, { recursive: true });
  const submission = {
    submitted_at: new Date().toISOString(),
    fleet_evidence_class: 'independent',
    fleet_submission_ready: true,
    project_root: consumerRoot,
    plugin_root: pluginRoot,
    git: { origin: `https://example.com/independent-${idx}.git`, head: `abc${idx}` },
    evidence: {
      submission_readiness: {
        organic_live: 3,
        tier_totals_work_items: 3,
        portfolio_multiplier: 0.01,
        fleet_submission_ready: true,
      },
    },
  };
  const name = `fixture-independent-${idx}.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(submission, null, 2));
  return name;
}

function main() {
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-scale-gate-'));
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(tmpRoot, `fleet-scale-gate-fixture-${date}.json`);

  const consumers = [
    path.join(tmpRoot, 'consumer-a'),
    path.join(tmpRoot, 'consumer-b'),
    path.join(tmpRoot, 'consumer-c'),
  ];
  for (const c of consumers) fs.mkdirSync(c, { recursive: true });
  for (let i = 0; i < consumers.length; i++) writeArchive(tmpRoot, consumers[i], i + 1);

  const gate = evaluateFleetScaleGate(tmpRoot);
  const payload = {
    generated_at: new Date().toISOString(),
    ok: gate.met === true,
    measurement_contract:
      'Isolated tmp plugin root with 3 fixture independent archives. Proves fleet-scale gate mechanics — not real external fleet traffic. Pack goal_complete still requires npm run objective-evidence on the real plugin root.',
    fixture_plugin_root: tmpRoot,
    fleet_scale_gate: gate,
    goal_complete_derivation: gate.met,
  };

  if (outIdx < 0) {
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  } else {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  }

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log(`fleet-scale-gate-fixture: wrote ${outPath}`);
  console.log(
    `  distinct_independent_consumers=${gate.distinct_independent_consumers} met=${gate.met} goal_complete_derivation=${payload.goal_complete_derivation}`
  );
  process.exit(payload.ok ? 0 : 1);
}

main();
