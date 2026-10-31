'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('../memory/config.cjs');
const { summarizeProcedures } = require('../skills/procedure-ritual-skills.cjs');
const { suggestSkillEvalFromProcedures } = require('../skills/skill-eval-suggestions.cjs');
const { buildSubmissionReadiness } = require('../fleet/submission-readiness.cjs');

/**
 * Muscle-memory readiness checks for consumer repos and pack dogfood.
 * @param {{ projectRoot: string, pluginRoot: string }} opts
 */
function checkMuscleMemoryReadiness(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const consumerMode = projectRoot !== pluginRoot;
  const checks = [];

  const agenticDir = path.join(projectRoot, '.agentic-swe');
  let memoryWritable = false;
  try {
    fs.mkdirSync(agenticDir, { recursive: true });
    const probe = path.join(agenticDir, `.doctor-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    memoryWritable = true;
  } catch {
    memoryWritable = false;
  }
  checks.push({ id: 'memory_store_writable', ok: memoryWritable });

  let sqlitePath = null;
  try {
    const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
    sqlitePath = sqlitePathForProject(merged, projectRoot);
    checks.push({ id: 'memory_sqlite_configured', ok: Boolean(sqlitePath) });
  } catch {
    checks.push({ id: 'memory_sqlite_configured', ok: false });
  }

  const sessionStop = path.join(pluginRoot, 'hooks', 'session-stop');
  const cursorCostSync =
    fs.existsSync(sessionStop) && fs.readFileSync(sessionStop, 'utf8').includes('hook-record-cost.cjs');
  checks.push({ id: 'cursor_stop_cost_sync', ok: cursorCostSync });

  const hooksJson = path.join(pluginRoot, 'hooks', 'hooks.json');
  const claudeCostSync =
    fs.existsSync(hooksJson) && fs.readFileSync(hooksJson, 'utf8').includes('hook-record-cost.cjs');
  checks.push({ id: 'claude_stop_cost_sync', ok: claudeCostSync });

  const worklogsRoot = path.join(projectRoot, '.worklogs');
  checks.push({
    id: 'worklogs_root',
    ok: true,
    exists: fs.existsSync(worklogsRoot),
    hint: consumerMode
      ? 'Set AGENTIC_SWE_PROJECT_ROOT to this repo when using the plugin from another cwd'
      : undefined,
  });

  const requiredOk = checks.filter((c) =>
    ['memory_store_writable', 'cursor_stop_cost_sync', 'claude_stop_cost_sync'].includes(c.id)
  );
  const muscleOk = requiredOk.every((c) => c.ok === true);

  const procedures = summarizeProcedures({ projectRoot, pluginRoot });
  let skillEval = { promote_candidates: [], evaluate_procedure_first: [] };
  try {
    const suggested = suggestSkillEvalFromProcedures({ projectRoot, pluginRoot });
    skillEval = {
      promote_candidates: suggested.promote_candidates || [],
      scaffold_candidates: suggested.scaffold_candidates || [],
      evaluate_procedure_first: (suggested.suggestions || [])
        .filter((s) => s.action === 'evaluate_procedure_first')
        .map((s) => s.skill),
    };
  } catch {
    /* optional */
  }

  const submission = buildSubmissionReadiness({
    projectRoot,
    pluginRoot,
    muscleMemoryOk: muscleOk,
  });

  return {
    ok: muscleOk,
    consumer_mode: consumerMode,
    memory_sqlite_path: sqlitePath,
    procedures,
    skill_eval: skillEval,
    checks,
    fleet_evidence: {
      organic_live: submission.organic_live,
      tier_totals_work_items: submission.tier_totals_work_items,
      organic_with_tier_totals: submission.organic_with_tier_totals,
      organic_missing_tier_totals: submission.organic_missing_tier_totals,
      portfolio_multiplier: submission.portfolio_multiplier,
      portfolio_target_met: submission.portfolio_target_met,
      fleet_submission_ready: submission.fleet_submission_ready,
      blockers: submission.blockers,
      next_command: submission.fleet_submission_ready
        ? 'npm run fleet-evidence-bundle -- --project-root <repo> --out fleet-evidence.json'
        : 'npm run fleet-onboard -- --project-root <repo>',
    },
  };
}

module.exports = { checkMuscleMemoryReadiness };
