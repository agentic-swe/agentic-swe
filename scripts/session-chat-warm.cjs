#!/usr/bin/env node
/**
 * Best-effort chat ingest + session procedure mine before memory-prime.
 * Opt out: AGENTIC_SWE_CHAT_WARM=0
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { discoverTranscriptSources } = require('./lib/memory/discover-transcripts.cjs');
const { ingestTranscripts } = require('./lib/memory/session-ingest.cjs');
const { mineSessionProcedures } = require('./lib/descent/mine-session-procedures.cjs');
const { mineTranscriptProcedures } = require('./lib/descent/mine-transcript-procedures.cjs');
const { ingestTeamEvents, ingestOrganicWorklogs, ingestProjectSkills } = require('./lib/memory/ingest-scopes.cjs');

async function warmChatMemory(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const discovered = discoverTranscriptSources(projectRoot);
  const files = (discovered.files || []).slice(0, 12);
  if (files.length) {
    await ingestTranscripts({
      projectRoot,
      pluginRoot,
      transcriptPaths: files,
      maxFiles: 12,
    });
  }
  const sessionMine = await mineSessionProcedures({
    projectRoot,
    pluginRoot,
    storeRoot: projectRoot,
    limit: opts.limit || 8,
  });
  const transcriptMine = mineTranscriptProcedures({
    projectRoot,
    pluginRoot,
    storeRoot: projectRoot,
    limit: opts.limit || 8,
  });
  let team = { events: 0 };
  let organic = { work_items: 0, chunks: 0 };
  let projectSkills = { skills: 0, chunks: 0 };
  try {
    team = await ingestTeamEvents({ projectRoot, pluginRoot });
  } catch {
    /* optional */
  }
  try {
    organic = await ingestOrganicWorklogs({ projectRoot, pluginRoot });
  } catch {
    /* optional */
  }
  try {
    projectSkills = await ingestProjectSkills({ projectRoot, pluginRoot });
  } catch {
    /* optional */
  }
  return {
    transcripts: files.length,
    session: sessionMine,
    transcript: transcriptMine,
    team,
    organic,
    project_skills: projectSkills,
  };
}

async function main() {
  if (/^(0|false|no|off)$/i.test(String(process.env.AGENTIC_SWE_CHAT_WARM || ''))) {
    process.exit(0);
  }
  let projectRoot = process.env.AGENTIC_SWE_PROJECT_ROOT || process.cwd();
  let pluginRoot = process.env.AGENTIC_SWE_PLUGIN_ROOT || getDefaultPluginRoot();
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--project-root') projectRoot = process.argv[++i];
    else if (process.argv[i] === '--plugin-root') pluginRoot = process.argv[++i];
  }
  projectRoot = path.resolve(projectRoot);
  pluginRoot = path.resolve(pluginRoot);

  await warmChatMemory({ projectRoot, pluginRoot, limit: 8 });
  process.exit(0);
}

module.exports = { warmChatMemory };

main().catch(() => process.exit(0));
