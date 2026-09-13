#!/usr/bin/env node
/**
 * Self-evolution cycle: mine session chunks → L1 procedures, emit team sync event.
 *
 * Usage:
 *   node scripts/evolve-cycle.cjs [--project-root dir] [--plugin-root dir] [--json]
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');

async function runEvolveCycle(opts) {
  const projectRoot = path.resolve(opts.projectRoot || process.cwd());
  const pluginRoot = path.resolve(opts.pluginRoot || getDefaultPluginRoot());

  let mine = { procedures: 0, mined: 0 };
  try {
    const { mineSessionProcedures } = require('./lib/descent/mine-session-procedures.cjs');
    mine = await mineSessionProcedures({
      projectRoot,
      pluginRoot,
      limit: opts.limit || 40,
    });
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }

  let repo = { procedures: 0, mined: 0 };
  try {
    const { mineRepoRituals } = require('./lib/descent/mine-repo-rituals.cjs');
    repo = mineRepoRituals({ projectRoot, pluginRoot, limit: 8 });
  } catch {
    /* optional */
  }

  let transcript = { procedures: 0, mined: 0 };
  try {
    const { mineTranscriptProcedures } = require('./lib/descent/mine-transcript-procedures.cjs');
    transcript = mineTranscriptProcedures({
      projectRoot,
      pluginRoot,
      limit: opts.limit || 40,
    });
  } catch {
    /* optional */
  }

  let gitMine = { procedures: 0, mined: 0 };
  try {
    const { mineGitProcedures } = require('./lib/descent/mine-git-procedures.cjs');
    gitMine = mineGitProcedures({
      projectRoot,
      pluginRoot,
      storeRoot: opts.storeRoot || projectRoot,
      limit: opts.limit || 12,
    });
  } catch {
    /* optional */
  }

  let organicCapture = { captured: 0, skipped: 0 };
  try {
    const { captureOrganicWorklogs } = require('./lib/descent/capture-organic-worklogs.cjs');
    organicCapture = captureOrganicWorklogs({
      projectRoot,
      pluginRoot,
      storeRoot: opts.storeRoot || projectRoot,
      includeFixtures: false,
      preferIsolatedTest: true,
    });
  } catch {
    /* optional */
  }

  let organicMemory = { work_items: 0, chunks: 0 };
  try {
    const { ingestOrganicWorklogs } = require('./lib/memory/ingest-scopes.cjs');
    organicMemory = await ingestOrganicWorklogs({ projectRoot, pluginRoot });
  } catch {
    /* optional */
  }

  let teamEventsIngested = 0;
  let skillEvalSuggestions = { suggestions: [], promote_candidates: [] };
  try {
    const { suggestSkillEvalFromProcedures } = require('./lib/skills/skill-eval-suggestions.cjs');
    skillEvalSuggestions = suggestSkillEvalFromProcedures({ projectRoot, pluginRoot });
  } catch {
    /* optional */
  }

  let ritualPromote = null;
  let ritualScaffold = null;
  if (opts.promoteRituals || opts.scaffoldRituals) {
    try {
      const { runSkillEvolutionPipeline } = require('./lib/skills/skill-eval-suggestions.cjs');
      const pipe = await runSkillEvolutionPipeline({
        projectRoot,
        pluginRoot,
        scaffold: opts.scaffoldRituals === true,
        promote: opts.promoteRituals === true,
        dryRun: opts.dryRun,
        ingestMemory: !opts.dryRun,
      });
      ritualScaffold = pipe.scaffold;
      ritualPromote = pipe.promote;
    } catch (e) {
      const err = { ok: false, error: String(e.message || e) };
      if (opts.scaffoldRituals) ritualScaffold = err;
      if (opts.promoteRituals) ritualPromote = err;
    }
  }

  let sync = null;
  try {
    const { appendLocalEvent } = require('./lib/sync/git-sync.cjs');
    sync = appendLocalEvent({
      projectRoot,
      event: {
        kind: 'evolve-cycle',
        label: `mined ${mine.procedures || 0} session + ${repo.procedures || 0} repo-ritual + ${transcript.procedures || 0} transcript-tool + ${gitMine.procedures || 0} git-history candidates; organic capture ${organicCapture.captured || 0}; skill-promote ${skillEvalSuggestions.promote_candidates.length}; skill-scaffold ${skillEvalSuggestions.scaffold_candidates?.length || 0}`,
        scope: 'team',
        procedures: (mine.procedures || 0) + (repo.procedures || 0) + (transcript.procedures || 0) + (gitMine.procedures || 0),
      },
    });
    if (sync) {
      const { ingestTeamEvents } = require('./lib/memory/ingest-scopes.cjs');
      const ingested = await ingestTeamEvents({ projectRoot, pluginRoot });
      teamEventsIngested = ingested.events || 0;
    }
  } catch {
    /* optional offline */
  }

  return {
    ok: true,
    procedures_mined: (mine.procedures || 0) + (repo.procedures || 0) + (transcript.procedures || 0) + (gitMine.procedures || 0),
    session_procedures_mined: mine.procedures || 0,
    repo_rituals_mined: repo.procedures || 0,
    transcript_procedures_mined: transcript.procedures || 0,
    git_procedures_mined: gitMine.procedures || 0,
    organic_captured: organicCapture.captured || 0,
    organic_skipped: organicCapture.skipped || 0,
    organic_memory_items: organicMemory.work_items || 0,
    team_events_ingested: teamEventsIngested,
    skill_eval_suggestions: skillEvalSuggestions.suggestions,
    skill_eval_promote_candidates: skillEvalSuggestions.promote_candidates,
    skill_eval_scaffold_candidates: skillEvalSuggestions.scaffold_candidates || [],
    ritual_skill_promote: ritualPromote,
    ritual_skill_scaffold: ritualScaffold,
    commands_seen: mine.mined || 0,
    sqlite_path: mine.sqlitePath,
    team_sync: Boolean(sync),
  };
}

async function main() {
  const args = { json: process.argv.includes('--json') };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--project-root') args.projectRoot = process.argv[++i];
    else if (a === '--plugin-root') args.pluginRoot = process.argv[++i];
    else if (a === '--limit') args.limit = Number(process.argv[++i]);
    else if (a === '--promote-rituals') args.promoteRituals = true;
    else if (a === '--scaffold-rituals') args.scaffoldRituals = true;
    else if (a === '--evolve-skills') {
      args.scaffoldRituals = true;
      args.promoteRituals = true;
    }
    else if (a === '--dry-run') args.dryRun = true;
  }

  const r = await runEvolveCycle(args);
  if (args.json) console.log(JSON.stringify(r, null, 2));
  else if (r.ok) {
    console.log(
      `evolve-cycle: ${r.procedures_mined} procedure candidates (session ${r.session_procedures_mined}, repo ${r.repo_rituals_mined}, transcript ${r.transcript_procedures_mined}, git ${r.git_procedures_mined}); organic capture ${r.organic_captured || 0}`
    );
  } else {
    console.error('evolve-cycle failed:', r.error);
  }
  process.exit(r.ok ? 0 : 1);
}

module.exports = { runEvolveCycle };

if (require.main === module) main();
