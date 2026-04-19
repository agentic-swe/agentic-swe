#!/usr/bin/env node
/**
 * Headless work engine CLI (Phase 1). Same rules as programmatic checks in scripts/lib/work-engine/.
 *
 * Usage:
 *   node scripts/work-engine.cjs --work-dir .worklogs/<id> validate [--json]
 *   node scripts/work-engine.cjs --work-dir .worklogs/<id> budget [--json]
 *   node scripts/work-engine.cjs --work-dir .worklogs/<id> transition --to <state> --actor <id> [--from <state>] [--reason str] [--evidence rel/a,rel/b] [--dry-run] [--no-decrement-budget] [--json]
 *   node scripts/work-engine.cjs init --id <id> --task "description" [--work-root <dir>] [--plugin-root <pack>] [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  getDefaultPluginRoot,
  validateWorkDir,
  validateTransition,
  applyTransition,
  loadWorkItem,
} = require('./lib/work-engine/engine.cjs');
const {
  loadMergedBudgetThresholds,
  applyTrackBudgetProfile,
  projectRootFromWorkDir,
} = require('./lib/work-engine/budget-config.cjs');

function parseArgs(argv) {
  const out = { flags: {} };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--no-decrement-budget') out.noDecrementBudget = true;
    else if (a === '--work-dir') out.workDir = argv[++i];
    else if (a === '--plugin-root') out.pluginRoot = argv[++i];
    else if (a === '--work-root') out.workRoot = argv[++i];
    else if (a === '--id') out.id = argv[++i];
    else if (a === '--task') out.task = argv[++i];
    else if (a === '--to') out.to = argv[++i];
    else if (a === '--from') out.from = argv[++i];
    else if (a === '--actor') out.actor = argv[++i];
    else if (a === '--reason') out.reason = argv[++i];
    else if (a === '--evidence') out.evidence = argv[++i];
    else if (a === '--transcript-path') out.transcriptPath = argv[++i];
    else if (a === '--cwd') out.cwd = argv[++i];
    else if (a === '--project-root') out.projectRoot = argv[++i];
    else if (a === '--budget-profile') out.budgetProfile = argv[++i];
    else if (a === '--set-pipeline-track') out.setPipelineTrack = argv[++i];
    else if (a === '--track') out.track = argv[++i];
    else if (!a.startsWith('-')) rest.push(a);
  }
  out.command = rest[0];
  return out;
}

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function fail(msg, code, extra) {
  const payload = { ok: false, message: msg, code, ...extra };
  if (process.argv.includes('--json')) {
    printJson(payload);
  } else {
    console.error(payload.message);
    if (extra && extra.schemaErrors) console.error(JSON.stringify(extra.schemaErrors, null, 2));
  }
  process.exit(code || 1);
}

function main() {
  const args = parseArgs(process.argv);
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const cmd = args.command;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(`agentic-swe work-engine

Commands:
  init --id <id> [--task "…"] [--work-root <dir>] [--plugin-root <pack>] [--json]
  validate --work-dir <.worklogs/id> [--plugin-root <pack>] [--json]
  budget   --work-dir <.worklogs/id> [--plugin-root <pack>] [--json]
  plan-transition --work-dir <dir> --to <state> [--from <state>] [--evidence a,b] [--json]
  transition --work-dir <dir> --to <state> --actor <id> [--from …] [--reason …] [--evidence …] [--dry-run] [--no-decrement-budget] [--json]
  record-cost --transcript-path <abs.jsonl> [--work-dir <.worklogs/id>] [--project-root <abs>] [--cwd <project>] [--dry-run] [--json]
      (omit --work-dir to use AGENTIC_SWE_WORK_DIR or discover under project root: --project-root, AGENTIC_SWE_PROJECT_ROOT, --cwd, then pwd)
  init … [--budget-profile lean|standard|rigorous]  (sets iteration/cost ceilings + budget.policy from config; optional early pipeline.track)
  apply-budget-profile --work-dir <dir> --track lean|standard|rigorous [--json]
  transition … [--set-pipeline-track lean|standard|rigorous]  (when leaving lean-track-check; merges track budgets from config)
  doctor [--project-root <abs>] [--plugin-root <pack>] [--json]
      Prints project root, plugin root, discovered active work dir, schema/budget snapshot.
      Exits 1 if the active item fails JSON Schema validation or budget verdict is STOP.
  migrate [--apply] …
      Delegates to scripts/migrate-work-state.js (same flags as that script).
`);
    process.exit(0);
  }

  if (cmd === 'migrate') {
    const migrateScript = path.join(__dirname, 'migrate-work-state.js');
    const mi = process.argv.indexOf('migrate');
    const restArgs = mi >= 0 ? process.argv.slice(mi + 1) : [];
    const r = spawnSync(process.execPath, [migrateScript, ...restArgs], { stdio: 'inherit' });
    process.exit(r.status === null ? 1 : r.status);
  }

  if (cmd === 'doctor') {
    const { discoverActiveWorkDirWithMeta, listActiveCandidates } = require('./lib/work-engine/discover-workdir.cjs');
    const { checkBudgets } = require('./lib/work-engine/budget.cjs');
    const projectRoot = path.resolve(
      args.projectRoot || process.env.AGENTIC_SWE_PROJECT_ROOT || process.cwd()
    );
    const pluginRootResolved = pluginRoot;
    const schemaPath = path.join(pluginRootResolved, 'schemas', 'work-item.schema.json');
    let schemaSupportedRange = 'work-item.schema.json (draft 2020-12)';
    if (fs.existsSync(schemaPath)) {
      try {
        const sch = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
        const minV = sch.properties && sch.properties.schema_version && sch.properties.schema_version.minimum;
        schemaSupportedRange =
          typeof minV === 'number' ? `schema_version integer >= ${minV} per ${path.basename(schemaPath)}` : schemaSupportedRange;
      } catch {
        /* keep default */
      }
    }
    const candidates = listActiveCandidates(projectRoot);
    const meta = discoverActiveWorkDirWithMeta(projectRoot);
    const activeWorkDir = meta.workDir;
    let loadedState = null;
    let loadResult = null;
    let budgetCheck = null;
    if (activeWorkDir) {
      loadResult = loadWorkItem(activeWorkDir, pluginRootResolved);
      if (loadResult.ok) {
        loadedState = loadResult.state;
        budgetCheck = checkBudgets(loadedState, { pluginRoot: pluginRootResolved, workDir: activeWorkDir });
      }
    }
    const schemaOk = !activeWorkDir || (loadResult && loadResult.ok);
    const budgetOk = !activeWorkDir || (budgetCheck && budgetCheck.ok);
    const exitCode = activeWorkDir && (!schemaOk || !budgetOk) ? 1 : 0;
    const report = {
      ok: exitCode === 0,
      project_root: projectRoot,
      plugin_root: pluginRootResolved,
      active_work_dir: activeWorkDir,
      active_non_completed_count: candidates.length,
      discover_warning: meta.warning || undefined,
      schema_supported_range: schemaSupportedRange,
      schema_version: loadedState ? loadedState.schema_version : null,
      budget_snapshot: loadedState
        ? {
            iteration_budget: loadedState.budget && loadedState.budget.iteration_budget,
            budget_remaining: loadedState.budget && loadedState.budget.budget_remaining,
            cost_used: loadedState.budget && loadedState.budget.cost_used,
            cost_budget_usd: loadedState.budget && loadedState.budget.cost_budget_usd,
            cost_ledger: loadedState.budget && loadedState.budget.cost_ledger,
          }
        : null,
      budget_verdict: budgetCheck,
      validate: activeWorkDir
        ? loadResult && loadResult.ok
          ? { ok: true }
          : {
              ok: false,
              code: loadResult && loadResult.code,
              message: loadResult && loadResult.message,
              schemaErrors: loadResult && loadResult.schemaErrors,
            }
        : { ok: true, skipped: true },
    };
    if (args.json) {
      printJson(report);
    } else {
      console.log('project_root', projectRoot);
      console.log('plugin_root', pluginRootResolved);
      console.log('schema_supported_range', schemaSupportedRange);
      console.log('active_non_completed_count', candidates.length);
      console.log('active_work_dir', activeWorkDir || '(none)');
      if (meta.warning) console.error(meta.warning);
      if (loadedState) {
        console.log('schema_version', loadedState.schema_version);
        const b = loadedState.budget || {};
        console.log(
          'budget',
          'iteration_budget',
          b.iteration_budget,
          'budget_remaining',
          b.budget_remaining,
          'cost_used',
          b.cost_used,
          'cost_budget_usd',
          b.cost_budget_usd
        );
        if (b.cost_ledger) console.log('cost_ledger', JSON.stringify(b.cost_ledger));
        if (budgetCheck) console.log('budget_verdict', budgetCheck.verdict, budgetCheck.errors.join('; ') || '');
      }
      if (activeWorkDir && loadResult && !loadResult.ok) {
        console.error('validate', loadResult.message);
        if (loadResult.schemaErrors) console.error(JSON.stringify(loadResult.schemaErrors, null, 2));
      }
    }
    process.exit(exitCode);
  }

  if (cmd === 'init') {
    if (!args.id) fail('init requires --id', 2);
    const workRoot = path.resolve(args.workRoot || process.cwd());
    const workDir = path.join(workRoot, '.worklogs', args.id);
    if (fs.existsSync(workDir)) fail(`work dir already exists: ${workDir}`, 2);
    fs.mkdirSync(workDir, { recursive: true });
    const stateTpl = path.join(pluginRoot, 'templates', 'state.json');
    const progressTpl = path.join(pluginRoot, 'templates', 'progress.md');
    const auditTpl = path.join(pluginRoot, 'templates', 'audit.log');
    const now = new Date();
    const nowIso = now.toISOString();
    const timeoutIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    let stateRaw = fs.readFileSync(stateTpl, 'utf8');
    const task = args.task != null ? String(args.task) : '';
    stateRaw = stateRaw
      .replace('<work-id>', args.id)
      .replace('<user task>', task)
      .replace(/"current_state": "[^"]*"/, '"current_state": "initialized"');
    stateRaw = stateRaw.replace(/<ISO-8601 timestamp>/g, nowIso);
    const state = JSON.parse(stateRaw);
    state.updated_at = nowIso;
    state.created_at = nowIso;
    state.timeout_at = timeoutIso;
    const mergedInit = loadMergedBudgetThresholds(pluginRoot, workRoot);
    if (args.budgetProfile) {
      state.pipeline = state.pipeline || {};
      state.pipeline.track = args.budgetProfile;
      applyTrackBudgetProfile(state, args.budgetProfile, mergedInit, { updateMoney: true });
    } else {
      applyTrackBudgetProfile(state, 'rigorous', mergedInit, { updateMoney: false });
    }
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
    fs.copyFileSync(progressTpl, path.join(workDir, 'progress.md'));
    fs.copyFileSync(auditTpl, path.join(workDir, 'audit.log'));
    const out = { ok: true, workDir, id: args.id };
    if (args.json) printJson(out);
    else console.log(workDir);
    return;
  }

  if (cmd === 'apply-budget-profile') {
    if (!args.workDir) fail('missing --work-dir', 2);
    const wd = path.resolve(args.workDir);
    const track = args.track || args.budgetProfile;
    if (!track || !['lean', 'standard', 'rigorous'].includes(track)) {
      fail('apply-budget-profile requires --track lean|standard|rigorous', 2);
    }
    const projectRoot = projectRootFromWorkDir(wd);
    if (!projectRoot) fail('apply-budget-profile: work-dir must be .worklogs/<id>', 2);
    const merged = loadMergedBudgetThresholds(pluginRoot, projectRoot);
    const loaded = loadWorkItem(wd, pluginRoot);
    if (!loaded.ok) {
      if (args.json) printJson(loaded);
      else fail(loaded.message, 1, loaded);
      process.exit(1);
    }
    const state = loaded.state;
    state.pipeline = state.pipeline || {};
    state.pipeline.track = track;
    applyTrackBudgetProfile(state, track, merged, { updateMoney: true });
    state.updated_at = new Date().toISOString();
    const tmp = `${loaded.statePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, loaded.statePath);
    const out = { ok: true, workDir: wd, pipeline: state.pipeline, budget: state.budget };
    if (args.json) printJson(out);
    else console.log('OK', track, state.budget.iteration_budget, state.budget.cost_budget_usd);
    return;
  }

  if (cmd === 'record-cost') {
    const { discoverActiveWorkDirWithMeta } = require('./lib/work-engine/discover-workdir.cjs');
    const { syncCostFromTranscript } = require('./lib/work-engine/transcript-cost.cjs');
    if (!args.transcriptPath) fail('record-cost requires --transcript-path', 2);
    const projectRoot = path.resolve(
      args.projectRoot || process.env.AGENTIC_SWE_PROJECT_ROOT || args.cwd || process.cwd()
    );
    let discoverMeta = null;
    const workDirResolved = args.workDir
      ? path.resolve(args.workDir)
      : process.env.AGENTIC_SWE_WORK_DIR
        ? path.resolve(process.env.AGENTIC_SWE_WORK_DIR)
        : (() => {
            discoverMeta = discoverActiveWorkDirWithMeta(projectRoot);
            return discoverMeta.workDir;
          })();
    if (discoverMeta && discoverMeta.warning) {
      if (args.json) {
        /* warning merged into success payload below */
      } else {
        console.error(discoverMeta.warning);
      }
    }
    if (!workDirResolved) {
      fail(
        'record-cost: provide --work-dir, set AGENTIC_SWE_WORK_DIR, or run from a project with .worklogs/<active-id>/',
        2
      );
    }
    const tp = path.resolve(args.transcriptPath);
    const r = syncCostFromTranscript({
      workDir: workDirResolved,
      transcriptPath: tp,
      dryRun: args.dryRun,
    });
    if (!r.ok) {
      if (args.json) printJson(r);
      else fail(r.message || 'record-cost failed', 1, r);
      process.exit(1);
    }
    if (args.json) printJson(discoverMeta && discoverMeta.warning ? { ...r, warning: discoverMeta.warning } : r);
    else if (r.dryRun) console.log('dry-run', r);
    else console.log('cost_used', r.cost_used, 'delta_usd', r.delta_usd);
    return;
  }

  if (!args.workDir) fail('missing --work-dir', 2);
  const workDir = path.resolve(args.workDir);

  if (cmd === 'validate') {
    const r = validateWorkDir(workDir, pluginRoot);
    if (!r.ok) {
      if (args.json) printJson(r);
      else fail(r.message || 'validate failed', 1, r);
      process.exit(1);
    }
    const out = { ok: true, verdict: 'VALID', current_state: r.state.current_state };
    if (args.json) printJson(out);
    else console.log('VALID', r.state.current_state);
    return;
  }

  if (cmd === 'budget') {
    const loaded = loadWorkItem(workDir, pluginRoot);
    if (!loaded.ok) {
      if (args.json) printJson(loaded);
      else fail(loaded.message, 1, loaded);
      process.exit(1);
    }
    const { checkBudgets } = require('./lib/work-engine/budget.cjs');
    const b = checkBudgets(loaded.state, { pluginRoot, workDir });
    const out = { ok: b.ok, verdict: b.verdict, details: b.details, errors: b.errors };
    if (args.json) printJson(out);
    else console.log(b.verdict, b.errors.length ? b.errors.join('; ') : 'ok');
    process.exit(b.ok ? 0 : 1);
  }

  if (cmd === 'transition') {
    if (!args.to) fail('transition requires --to', 2);
    if (!args.actor) fail('transition requires --actor', 2);
    const evidence_refs = args.evidence
      ? args.evidence.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const r = applyTransition({
      workDir,
      pluginRoot,
      to: args.to,
      from: args.from,
      actor: args.actor,
      reason: args.reason,
      evidence_refs,
      dryRun: args.dryRun,
      decrementIterationBudget: !args.noDecrementBudget,
      setPipelineTrack: args.setPipelineTrack,
    });

    if (!r.ok) {
      if (args.json) printJson(r);
      else fail(r.message || 'transition failed', 1, r);
      process.exit(1);
    }
    const out = {
      ok: true,
      current_state: r.state ? r.state.current_state : r.nextState.current_state,
      dryRun: !!r.dryRun,
    };
    if (args.json) printJson(out);
    else console.log('OK', out.current_state, r.dryRun ? '(dry-run)' : '');
    return;
  }

  if (cmd === 'plan-transition') {
    const loaded = loadWorkItem(workDir, pluginRoot);
    if (!loaded.ok) {
      if (args.json) printJson(loaded);
      else fail(loaded.message, 1, loaded);
      process.exit(1);
    }
    const from = args.from || loaded.state.current_state;
    const to = args.to;
    if (!to) fail('plan-transition requires --to', 2);
    const v = validateTransition({
      workDir,
      pluginRoot,
      state: loaded.state,
      from,
      to,
      evidence_refs: args.evidence
        ? args.evidence.split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    });
    if (args.json) printJson(v);
    else console.log(v.ok ? 'ALLOWED' : 'BLOCKED', v.message || '');
    process.exit(v.ok ? 0 : 1);
  }

  fail(`unknown command: ${cmd}`, 2);
}

main();
