#!/usr/bin/env node
/**
 * Production holdout accumulation: purge circular corpus seeds, capture delivered holdout
 * tasks via validation-approved path into the live procedure store.
 *
 * Usage:
 *   node scripts/bench/accumulate-holdout-procedures.cjs [--no-purge] [--json]
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { accumulateDeliveredHoldout } = require('../lib/descent/holdout-capture.cjs');

function main() {
  const pluginRoot = getDefaultPluginRoot();
  const noPurge = process.argv.includes('--no-purge');
  const result = accumulateDeliveredHoldout({
    pluginRoot,
    projectRoot: pluginRoot,
    purge: !noPurge,
  });

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`accumulate-holdout: ${result.delivered} delivered holdout captures`);
    if (result.purged?.removed) {
      console.log(`  purged ${result.purged.removed} circular holdout corpus seeds`);
    }
    for (const c of result.captures || []) {
      console.log(`  captured ${c.task} → ${c.tier} (${c.verifyCommand})`);
    }
  }

  process.exit(result.ok ? 0 : 1);
}

main();
