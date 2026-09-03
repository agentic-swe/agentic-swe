#!/usr/bin/env node
/**
 * Backfill budget.tier_totals on completed organic /work via validation-descent.
 * Only items with approved validation artifacts (or pipeline.validation_status=approved).
 *
 * Usage:
 *   node scripts/fleet-backfill-tier-totals.cjs --project-root /path/to/consumer [--limit 10] [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { auditOrganicTierTotals } = require('./lib/bench/production-tier-totals.cjs');
const { runDescentOnValidationApproval } = require('./lib/descent/validation-descent.cjs');
const { buildSubmissionReadiness } = require('./lib/fleet/submission-readiness.cjs');

function parseArgs(argv) {
  const out = { json: false, limit: 10, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--limit') out.limit = Number(argv[++i]) || 10;
  }
  return out;
}

function canBackfillWorkItem(workDir) {
  const statePath = path.join(workDir, 'state.json');
  if (!fs.existsSync(statePath)) return { ok: false, reason: 'no state.json' };
  let state;
  try {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return { ok: false, reason: 'invalid state.json' };
  }
  if (state.current_state !== 'completed') {
    return { ok: false, reason: `not completed (${state.current_state})` };
  }
  const validationPath = path.join(workDir, 'validation-results.md');
  if (fs.existsSync(validationPath)) return { ok: true, mode: 'validation-descent' };
  if (state.pipeline?.validation_status === 'approved') {
    return { ok: true, mode: 'validation-descent' };
  }
  return { ok: false, reason: 'no approved validation artifact' };
}

async function backfillFleetTierTotals(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot || getDefaultPluginRoot());
  const projectRoot = path.resolve(opts.projectRoot);
  const before = auditOrganicTierTotals(projectRoot);
  const results = [];

  for (const workId of before.missing_work_ids.slice(0, opts.limit || 10)) {
    const workDir = path.join(projectRoot, '.worklogs', workId);
    const gate = canBackfillWorkItem(workDir);
    if (!gate.ok) {
      results.push({ work_id: workId, ok: false, skipped: true, reason: gate.reason });
      continue;
    }
    if (opts.dryRun) {
      results.push({ work_id: workId, ok: true, dry_run: true, mode: gate.mode });
      continue;
    }
    const r = await runDescentOnValidationApproval({ workDir, pluginRoot, projectRoot });
    results.push({
      work_id: workId,
      ok: r.ok === true,
      tier: r.tier,
      verify_command: r.verifyCommand,
      reason: r.reason || r.descent?.reason,
    });
  }

  const after = auditOrganicTierTotals(projectRoot);
  const readiness = buildSubmissionReadiness({ projectRoot, pluginRoot });

  return {
    ok: after.with_tier_totals >= 3,
    goal_complete: false,
    measurement_contract:
      'Backfills tier_totals via validation-descent on completed organic work with approved validation artifacts only.',
    project_root: projectRoot,
    before,
    after,
    submission_readiness: readiness,
    results,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.projectRoot) {
    console.error('fleet-backfill-tier-totals requires --project-root');
    process.exit(2);
  }
  const payload = await backfillFleetTierTotals(args);
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log('fleet-backfill-tier-totals: goal_complete=false');
    console.log(
      `  tier_totals: ${payload.before.with_tier_totals} → ${payload.after.with_tier_totals} (organic ${payload.after.organic})`
    );
    console.log(`  fleet_submission_ready: ${payload.submission_readiness.fleet_submission_ready}`);
    for (const r of payload.results) {
      console.log(`  - ${r.work_id}: ${r.ok ? `ok tier=${r.tier}` : r.skipped ? `skip ${r.reason}` : `fail ${r.reason || ''}`}`);
    }
  }
  process.exit(payload.submission_readiness.fleet_submission_ready ? 0 : 1);
}

module.exports = { backfillFleetTierTotals, canBackfillWorkItem };

if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.stack ? e.stack : e);
    process.exit(1);
  });
}
