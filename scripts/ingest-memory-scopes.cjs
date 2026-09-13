#!/usr/bin/env node
/**
 * Ingest memory from repo, sessions, team sync events, and personal profile.
 *
 * Usage:
 *   node scripts/ingest-memory-scopes.cjs [--project-root dir] [--skip-sessions] [--json]
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { runMemoryIndex } = require('./lib/memory/memory-pipeline.cjs');
const { ingestTranscripts } = require('./lib/memory/session-ingest.cjs');
const { discoverTranscriptSources } = require('./lib/memory/discover-transcripts.cjs');
const { ingestTeamEvents, ingestPersonalProfile, ingestOrganicWorklogs, ingestGitTeamHistory, ingestMuscleReplayWorklogs, ingestProjectSkills } = require('./lib/memory/ingest-scopes.cjs');
const { syncArchivedFleetSubmissionsMemory } = require('./lib/fleet/ingest-fleet-memory.cjs');

function parseArgs(argv) {
  const out = { json: false, skipSessions: false, allHosts: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--skip-sessions') out.skipSessions = true;
    else if (a === '--all-hosts') out.allHosts = true;
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
  }
  return out;
}

async function runMemoryScopeIngest(opts) {
  const projectRoot = path.resolve(opts.projectRoot || process.cwd());
  const pluginRoot = path.resolve(opts.pluginRoot || getDefaultPluginRoot());

  const repo = await runMemoryIndex({ projectRoot, pluginRoot });
  const personal = await ingestPersonalProfile({ projectRoot, pluginRoot });

  let session = { files: 0, chunks: 0 };
  if (!opts.skipSessions) {
    const files = [...(opts.transcriptPaths || [])];
    if (!opts.transcriptPaths) {
      const discovered = discoverTranscriptSources(projectRoot, { allHosts: opts.allHosts === true });
      files.push(...discovered.files);
    }
    if (files.length) {
      session = await ingestTranscripts({
        projectRoot,
        pluginRoot,
        transcriptPaths: files,
        maxFiles: opts.maxFiles || 200,
      });
    }
  }

  const team = await ingestTeamEvents({ projectRoot, pluginRoot });
  const gitTeam = await ingestGitTeamHistory({ projectRoot, pluginRoot });
  const worklogs = await ingestOrganicWorklogs({ projectRoot, pluginRoot });
  const muscleReplay = await ingestMuscleReplayWorklogs({ projectRoot, pluginRoot });
  const projectSkills = await ingestProjectSkills({ projectRoot, pluginRoot });

  let fleetMemory = { synced: 0, total: 0 };
  if (path.resolve(projectRoot) === path.resolve(pluginRoot)) {
    try {
      fleetMemory = await syncArchivedFleetSubmissionsMemory(pluginRoot);
    } catch {
      /* optional */
    }
  }

  return {
    ok: true,
    repo: { sqlite_path: repo.sqlitePath, stats: repo.stats },
    session,
    team,
    git_team: gitTeam,
    worklogs,
    muscle_replay: muscleReplay,
    project_skills: projectSkills,
    fleet_memory: fleetMemory,
    personal,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const r = await runMemoryScopeIngest(args);
  if (args.json) console.log(JSON.stringify(r, null, 2));
  else {
    console.log('ingest-memory-scopes:');
    console.log(`  repo: ${r.repo.sqlite_path}`);
    console.log(`  sessions: ${r.session.files || 0} files → ${r.session.chunks || 0} chunks`);
    console.log(`  team events: ${r.team.events}`);
    console.log(`  git team commits: ${r.git_team.commits || 0}`);
    console.log(`  organic worklogs: ${r.worklogs.work_items || 0} items → ${r.worklogs.chunks || 0} chunks`);
    console.log(`  muscle replay: ${r.muscle_replay.work_items || 0} items`);
    console.log(`  project skills: ${r.project_skills.skills || 0} → ${r.project_skills.chunks || 0} chunks`);
    if (r.fleet_memory?.total) {
      console.log(`  fleet memory: ${r.fleet_memory.synced}/${r.fleet_memory.total} archives indexed`);
    }
    console.log(`  personal: ${r.personal.constraints} constraints → ${r.personal.sqlitePath}`);
  }
}

module.exports = { runMemoryScopeIngest };

if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
}
