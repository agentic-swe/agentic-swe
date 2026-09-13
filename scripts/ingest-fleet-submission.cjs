#!/usr/bin/env node
/**
 * Maintainer ingest of consumer fleet-submission.json artifacts.
 * Archives under bench/results/fleet-submissions/ and emits team sync event.
 * Does not mark goal_complete — external validation still required.
 *
 * Usage:
 *   node scripts/ingest-fleet-submission.cjs --submission path/to/fleet-submission.json [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { appendLocalEvent } = require('./lib/sync/git-sync.cjs');
const { ingestTeamEvents } = require('./lib/memory/ingest-scopes.cjs');
const { isIndependentFleetSubmission } = require('./lib/fleet/seed-organic-work.cjs');
const { evaluateFleetScaleGate } = require('./lib/fleet/fleet-scale-gate.cjs');
const {
  listArchivedSubmissions,
  summarizeFleetSubmissions,
  findArchivesByGitOrigin,
} = require('./lib/fleet/submission-archive.cjs');
const {
  submissionDigest,
  findArchiveByDigest,
  ingestFleetSubmissionMemory,
} = require('./lib/fleet/ingest-fleet-memory.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--submission') out.submissionPath = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
  }
  return out;
}

/**
 * @param {{ submissionPath: string, pluginRoot: string }} opts
 */
async function ingestFleetSubmission(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const submissionPath = path.resolve(opts.submissionPath);
  if (!fs.existsSync(submissionPath)) {
    return { ok: false, error: `submission not found: ${submissionPath}` };
  }

  let submission;
  try {
    submission = JSON.parse(fs.readFileSync(submissionPath, 'utf8'));
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${e.message || e}` };
  }

  const projectRoot = path.resolve(submission.project_root || '');
  if (!projectRoot || projectRoot === pluginRoot) {
    return { ok: false, error: 'submission must be from a consumer repo (project_root ≠ plugin_root)' };
  }
  if (submission.fleet_submission_ready !== true) {
    return {
      ok: false,
      error: 'submission not fleet_submission_ready',
      blockers: submission.blockers || submission.submission_readiness?.blockers || [],
    };
  }

  const fleetClass = submission.fleet_evidence_class || 'independent';
  if (isIndependentFleetSubmission(submission)) {
    const { isKnownMaintainerDogfoodConsumer } = require('./lib/fleet/dogfood-consumers.cjs');
    if (isKnownMaintainerDogfoodConsumer(pluginRoot, projectRoot)) {
      return {
        ok: false,
        error:
          'independent fleet credit rejected: project_root was archived as maintainer_dogfood — use a distinct external consumer repo',
        fleet_evidence_class: fleetClass,
        project_root: projectRoot,
      };
    }
  }

  const digest = submissionDigest(submissionPath);
  const priorSameOrigin = findArchivesByGitOrigin(pluginRoot, submission.git?.origin);
  const existingArchive = findArchiveByDigest(pluginRoot, digest);
  if (existingArchive) {
    let teamMemory = null;
    try {
      teamMemory = await ingestFleetSubmissionMemory({
        submission,
        pluginRoot,
        archivePath: existingArchive,
      });
    } catch {
      /* optional */
    }
    return {
      ok: true,
      duplicate: true,
      goal_complete: false,
      archive_path: existingArchive,
      archive_name: path.basename(existingArchive),
      prior_archives_same_git_origin: priorSameOrigin.length,
      fleet_submissions_archived: listArchivedSubmissions(pluginRoot).length,
      team_memory: teamMemory,
      measurement_contract:
        'Duplicate fleet submission digest — existing archive retained. Does not satisfy product goal_complete.',
    };
  }

  const archiveDir = path.join(pluginRoot, 'bench', 'results', 'fleet-submissions');
  fs.mkdirSync(archiveDir, { recursive: true });
  const stamp = (submission.submitted_at || new Date().toISOString()).replace(/[:.]/g, '-');
  const archiveName = `${stamp}-${digest}.json`;
  const archivePath = path.join(archiveDir, archiveName);
  fs.copyFileSync(submissionPath, archivePath);

  const readiness = submission.evidence?.submission_readiness || submission;
  const eventFile = appendLocalEvent({
    projectRoot: pluginRoot,
    event: {
      kind: 'fleet-submission',
      scope: 'team',
      label: `fleet submission ingested: class=${submission.fleet_evidence_class || 'independent'} organic_live=${readiness.organic_live ?? '?'} portfolio=${readiness.portfolio_multiplier ?? '?'}`,
      consumer_project_root: projectRoot,
      fleet_evidence_class: submission.fleet_evidence_class || 'independent',
      git: submission.git || null,
      organic_live: readiness.organic_live,
      portfolio_multiplier: readiness.portfolio_multiplier,
      archive: path.relative(pluginRoot, archivePath),
    },
  });

  let teamIngest = { events: 0 };
  try {
    teamIngest = await ingestTeamEvents({ projectRoot: pluginRoot, pluginRoot });
  } catch {
    /* optional */
  }

  let teamMemory = null;
  try {
    teamMemory = await ingestFleetSubmissionMemory({ submission, pluginRoot, archivePath });
  } catch {
    /* optional */
  }

  let fleetSync = { synced: 0, total: 0 };
  try {
    const { syncArchivedFleetSubmissionsMemory } = require('./lib/fleet/ingest-fleet-memory.cjs');
    fleetSync = await syncArchivedFleetSubmissionsMemory(pluginRoot);
  } catch {
    /* optional */
  }

  const archived = listArchivedSubmissions(pluginRoot);
  const fleetScale = evaluateFleetScaleGate(pluginRoot);

  return {
    ok: true,
    goal_complete: false,
    fleet_scale: fleetScale,
    fleet_scale_met: fleetScale.met,
    archive_path: archivePath,
    archive_name: archiveName,
    prior_archives_same_git_origin: priorSameOrigin.length,
    git_origin_warning:
      priorSameOrigin.length > 0
        ? `git origin already has ${priorSameOrigin.length} archived submission(s) — confirm independent re-submission is intended`
        : undefined,
    team_event: eventFile,
    team_events_ingested: teamIngest.events || 0,
    team_memory: teamMemory,
    fleet_memory_sync: fleetSync,
    fleet_submissions_archived: archived.length,
    measurement_contract: fleetScale.met
      ? 'Fleet-scale gate met (≥3 independent consumers). Run npm run objective-evidence to verify pack goal_complete.'
      : 'Archived consumer fleet submission for maintainer review. Pack goal_complete requires full objective-evidence scorecard.',
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  if (!args.submissionPath) {
    console.error('ingest-fleet-submission requires --submission <fleet-submission.json>');
    process.exit(2);
  }

  const r = await ingestFleetSubmission({ submissionPath: args.submissionPath, pluginRoot });
  if (args.json) console.log(JSON.stringify(r, null, 2));
  else if (r.ok) {
    console.log(`ingest-fleet-submission: archived ${r.archive_name}`);
    console.log(`  fleet submissions on file: ${r.fleet_submissions_archived}`);
    console.log(`  team events ingested: ${r.team_events_ingested}`);
    if (r.fleet_scale_met) {
      console.log('  fleet_scale_met: true — run npm run objective-evidence to verify pack goal_complete');
    } else if (r.fleet_scale) {
      console.log(
        `  fleet_scale: ${r.fleet_scale.distinct_independent_consumers}/${r.fleet_scale.target} independent consumers`
      );
    }
  } else {
    console.error('ingest-fleet-submission failed:', r.error);
    if (r.blockers?.length) {
      for (const b of r.blockers) console.error(`  blocker: ${b}`);
    }
  }
  process.exit(r.ok ? 0 : 1);
}

module.exports = {
  ingestFleetSubmission,
  listArchivedSubmissions,
  summarizeFleetSubmissions,
  findArchivesByGitOrigin,
  isIndependentFleetSubmission,
};

if (require.main === module) main();
