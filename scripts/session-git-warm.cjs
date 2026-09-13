#!/usr/bin/env node
/**
 * Best-effort git team ingest before memory-prime (no procedure eval).
 * Opt out: AGENTIC_SWE_GIT_WARM=0
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { ingestGitTeamHistory } = require('./lib/memory/ingest-scopes.cjs');

async function main() {
  if (/^(0|false|no|off)$/i.test(String(process.env.AGENTIC_SWE_GIT_WARM || ''))) {
    process.exit(0);
  }
  let projectRoot = process.env.AGENTIC_SWE_PROJECT_ROOT || process.cwd();
  let pluginRoot = process.env.AGENTIC_SWE_PLUGIN_ROOT || getDefaultPluginRoot();
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--project-root') projectRoot = process.argv[++i];
    else if (process.argv[i] === '--plugin-root') pluginRoot = process.argv[++i];
  }
  await ingestGitTeamHistory({
    projectRoot: path.resolve(projectRoot),
    pluginRoot: path.resolve(pluginRoot),
    maxCommits: 20,
  });
  process.exit(0);
}

main().catch(() => process.exit(0));
