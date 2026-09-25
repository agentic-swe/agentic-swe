#!/usr/bin/env node
/**
 * Emit a short markdown hint: active work phase -> model tier (from model-routing config).
 * Used by hooks/session-start. Opt out: AGENTIC_SWE_MODEL_TIER_HINT=0
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { discoverActiveWorkDir } = require('./lib/work-engine/discover-workdir.cjs');
const { loadModelRouting, tierForPhase } = require('./lib/catalog/model-routing.cjs');
const { adviseModelTier, renderModelTierHint } = require('./lib/jev/tier.cjs');

function parseArgs(argv) {
  const args = argv.slice(2);
  let projectRoot = process.cwd();
  let pluginRoot = path.join(__dirname, '..');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project-root' && args[i + 1]) {
      projectRoot = path.resolve(args[++i]);
      continue;
    }
    if (args[i] === '--plugin-root' && args[i + 1]) {
      pluginRoot = path.resolve(args[++i]);
      continue;
    }
  }
  return { projectRoot, pluginRoot };
}

async function main() {
  const v = process.env.AGENTIC_SWE_MODEL_TIER_HINT;
  if (v === '0' || v === 'false' || v === 'off') return;

  const { projectRoot, pluginRoot } = parseArgs(process.argv);
  let workDir = process.env.AGENTIC_SWE_WORK_DIR
    ? path.resolve(process.env.AGENTIC_SWE_WORK_DIR)
    : discoverActiveWorkDir(projectRoot);
  if (!workDir || !fs.existsSync(path.join(workDir, 'state.json'))) {
    return;
  }
  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
  } catch {
    return;
  }
  const phase = state.current_state || 'unknown';
  const routing = loadModelRouting(pluginRoot, projectRoot);
  const tier = tierForPhase(routing, phase) || 'balanced';
  const wid = path.basename(workDir);
  let advice = null;
  const task = typeof state.task === 'string' ? state.task : '';
  if (task.trim()) {
    try {
      advice = await adviseModelTier({
        pluginRoot,
        projectRoot,
        workDir,
        phase,
        phaseTier: tier,
        task,
        env: process.env,
      });
    } catch {
      advice = null;
    }
  }
  const block = renderModelTierHint({ wid, phase, phaseTier: tier, advice });
  process.stdout.write(block + '\n');
}

if (require.main === module) {
  main().catch(() => process.exit(0));
}

module.exports = { parseArgs, main };
