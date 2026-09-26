#!/usr/bin/env node
/**
 * Descent compiler CLI: fingerprint, replay, promote, tier-rates.
 */
'use strict';

const path = require('node:path');
const { buildFingerprint } = require('./lib/descent/fingerprint.cjs');
const { replayProcedure } = require('./lib/descent/replay.cjs');
const { promoteOrDemote, tierHitRates, loadStore } = require('./lib/descent/promotion.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--files') out.files = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--verify') out.verify = argv[++i];
    else if (a === '--failure') out.failure = argv[++i];
    else if (a === '--fingerprint') out.fingerprint = argv[++i];
    else if (a === '--human-approved') out.humanApproved = true;
    else if (a === '--verify-failed') out.verifyFailed = true;
    else if (!a.startsWith('-')) out.command = a;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const projectRoot = args.projectRoot || process.cwd();
  const cmd = args.command || 'help';

  if (cmd === 'fingerprint') {
    const fp = buildFingerprint({
      files: args.files || [],
      verifyCommand: args.verify || '',
      failureSignature: args.failure || null,
    });
    if (args.json) console.log(JSON.stringify({ fingerprint: fp }, null, 2));
    else console.log(fp);
    return;
  }

  if (cmd === 'replay') {
    const store = loadStore(projectRoot);
    const fp = args.fingerprint;
    const rec = fp ? store.procedures.find((p) => p.fingerprint === fp) : store.procedures[0];
    if (!rec) {
      console.error('no procedure found');
      process.exit(1);
    }
    const r = replayProcedure({ projectRoot, procedure: rec.procedure, record: rec });
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else console.log(r.ok ? 'OK L0 replay' : `FAIL escalate ${r.tier}: ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  }

  if (cmd === 'promote') {
    const fp =
      args.fingerprint ||
      buildFingerprint({
        files: args.files || [],
        verifyCommand: args.verify || '',
        failureSignature: args.failure || null,
      });
    const r = promoteOrDemote({
      projectRoot,
      fingerprint: fp,
      procedure: {
        verify: args.verify ? [{ type: 'RUN', command: args.verify }] : [],
        actions: [],
      },
      evalPassed: true,
      humanApproved: args.humanApproved,
      verifyFailed: args.verifyFailed,
    });
    if (args.json) console.log(JSON.stringify(r, null, 2));
    else console.log(`tier=${r.record.tier} failures=${r.record.failures}`);
    return;
  }

  if (cmd === 'tier-rates') {
    const rates = tierHitRates(projectRoot);
    if (args.json) console.log(JSON.stringify(rates, null, 2));
    else console.log(JSON.stringify(rates));
    return;
  }

  console.log(`Usage:
  descent.cjs fingerprint --files a.js,b.js --verify "npm test"
  descent.cjs replay [--fingerprint <hash>] [--project-root dir]
  descent.cjs promote --files ... --verify "..." [--human-approved]
  descent.cjs tier-rates`);
}

main();
