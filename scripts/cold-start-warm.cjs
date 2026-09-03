#!/usr/bin/env node
/**
 * Day-one memory warming: sessions, git/docs, corpus L0 procedures, memory index.
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { runMemoryIndex } = require('./lib/memory/memory-pipeline.cjs');
const {
  ingestPersonalProfile,
  ingestTeamEvents,
  ingestGitTeamHistory,
  ingestOrganicWorklogs,
  ingestMuscleReplayWorklogs,
  ingestProjectSkills,
} = require('./lib/memory/ingest-scopes.cjs');
const { captureOrganicWorklogs } = require('./lib/descent/capture-organic-worklogs.cjs');
const { writeLessons } = require('./memory-reflect.cjs');
const { ingestTranscripts } = require('./lib/memory/session-ingest.cjs');
const { discoverTranscriptSources } = require('./lib/memory/discover-transcripts.cjs');
const { seedCorpusProcedures } = require('./lib/descent/corpus-seed.cjs');
const { syncArchivedFleetSubmissionsMemory } = require('./lib/fleet/ingest-fleet-memory.cjs');

function parseArgs(argv) {
  const out = { json: false, skipSessions: false };
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


async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = args.projectRoot || process.cwd();
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();

  const index = await runMemoryIndex({ projectRoot, pluginRoot });
  const personal = await ingestPersonalProfile({ projectRoot, pluginRoot });

  let lessonsPath = null;
  try {
    lessonsPath = writeLessons(projectRoot);
  } catch {
    /* optional */
  }

  let sessionIngest = null;
  if (!args.skipSessions) {
    const files = discoverTranscriptSources(projectRoot, {
      allHosts: args.allHosts === true,
    }).files;
    if (files.length) {
      sessionIngest = await ingestTranscripts({
        projectRoot,
        pluginRoot,
        transcriptPaths: files,
        maxFiles: 200,
      });
    }
  }

  let team = { events: 0 };
  try {
    team = await ingestTeamEvents({ projectRoot, pluginRoot });
  } catch {
    /* optional */
  }

  let gitTeam = { commits: 0 };
  try {
    gitTeam = await ingestGitTeamHistory({ projectRoot, pluginRoot });
  } catch {
    /* optional */
  }

  const corpusSeed = seedCorpusProcedures({
    pluginRoot,
    projectRoot: pluginRoot,
    include: (name) => name.startsWith('oracle-'),
  });

  let holdoutAccum = null;
  try {
    const { accumulateDeliveredHoldout } = require('./lib/descent/holdout-capture.cjs');
    holdoutAccum = accumulateDeliveredHoldout({ pluginRoot, projectRoot: pluginRoot });
  } catch {
    /* optional */
  }

  let sessionMine = null;
  try {
    const { runEvolveCycle } = require('./evolve-cycle.cjs');
    sessionMine = await runEvolveCycle({ projectRoot, pluginRoot });
  } catch {
    /* optional */
  }

  let organicCapture = { captured: 0, skipped: 0 };
  try {
    organicCapture = captureOrganicWorklogs({
      projectRoot,
      pluginRoot,
      includeFixtures: false,
      preferIsolatedTest: true,
    });
  } catch {
    /* optional */
  }

  let organicMemory = { work_items: 0, chunks: 0 };
  let muscleReplay = { work_items: 0 };
  let projectSkills = { skills: 0, chunks: 0 };
  try {
    organicMemory = await ingestOrganicWorklogs({ projectRoot, pluginRoot });
  } catch {
    /* optional */
  }
  try {
    muscleReplay = await ingestMuscleReplayWorklogs({ projectRoot, pluginRoot });
  } catch {
    /* optional */
  }
  try {
    projectSkills = await ingestProjectSkills({ projectRoot, pluginRoot });
  } catch {
    /* optional */
  }

  let fleetMemory = { synced: 0, total: 0 };
  if (path.resolve(projectRoot) === path.resolve(pluginRoot)) {
    try {
      fleetMemory = await syncArchivedFleetSubmissionsMemory(pluginRoot);
    } catch {
      /* optional */
    }
  }

  const out = {
    ok: true,
    style_constraints: personal.constraints,
    lessons_path: lessonsPath,
    session_ingest: sessionIngest,
    team_events: team.events,
    git_team_commits: gitTeam.commits || 0,
    personal_sqlite: personal.sqlitePath,
    corpus_l0_seeded: corpusSeed.seeded,
    holdout_procedures_captured: holdoutAccum?.delivered ?? 0,
    session_procedures_mined: sessionMine?.procedures_mined ?? sessionMine?.procedures ?? 0,
    organic_capture: organicCapture,
    organic_memory: organicMemory,
    muscle_replay: muscleReplay,
    project_skills: projectSkills,
    fleet_memory: fleetMemory,
    sqlite_path: index.sqlitePath,
    ingest: index.stats,
  };
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`cold-start-warm: ${personal.constraints} style constraints`);
    if (sessionIngest) {
      console.log(`  sessions: ${sessionIngest.files} files → ${sessionIngest.chunks} chunks`);
    }
    console.log(`  team events: ${team.events}`);
    console.log(`  git team commits: ${gitTeam.commits || 0}`);
    console.log(`  personal sqlite: ${personal.sqlitePath}`);
    console.log(`  corpus L0 procedures seeded: ${corpusSeed.seeded} (oracle-* only)`);
    if (holdoutAccum?.delivered) {
      console.log(`  holdout validation captures: ${holdoutAccum.delivered}`);
    }
    if (sessionMine?.procedures_mined || sessionMine?.procedures) {
      console.log(
        `  session procedures mined: ${sessionMine.procedures_mined ?? sessionMine.procedures} L1 candidates`
      );
    }
    if (organicCapture.captured) {
      console.log(`  organic worklog capture: ${organicCapture.captured} procedure(s)`);
    }
    if (organicMemory.work_items) {
      console.log(`  organic memory: ${organicMemory.work_items} work items → ${organicMemory.chunks} chunks`);
    }
    if (projectSkills.skills) {
      console.log(`  project skills: ${projectSkills.skills} → ${projectSkills.chunks} chunks`);
    }
    if (fleetMemory.total) {
      console.log(`  fleet memory: ${fleetMemory.synced}/${fleetMemory.total} archives indexed`);
    }
    console.log(`  memory index: ${index.sqlitePath}`);
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
