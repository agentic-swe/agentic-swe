#!/usr/bin/env node
/**
 * Headless work engine CLI (Phase 1). Same rules as programmatic checks in scripts/lib/work-engine/.
 *
 * Usage:
 *   node scripts/work-engine.cjs --work-dir .worklogs/<id> validate [--json]
 *   node scripts/work-engine.cjs --work-dir .worklogs/<id> budget [--json]
 *   node scripts/work-engine.cjs --work-dir .worklogs/<id> transition --to <state> --actor <id> [--from <state>] [--reason str] [--evidence rel/a,rel/b] [--dry-run] [--no-decrement-budget] [--skip-muscle-memory] [--json]
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
  recordSpawn,
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
    else if (a === '--skip-muscle-memory') out.skipMuscleMemory = true;
    else if (a === '--work-dir') out.workDir = argv[++i];
    else if (a === '--plugin-root') out.pluginRoot = argv[++i];
    else if (a === '--work-root') out.workRoot = argv[++i];
    else if (a === '--id') out.id = argv[++i];
    else if (a === '--task') out.task = argv[++i];
    else if (a === '--to') out.to = argv[++i];
    else if (a === '--from') out.from = argv[++i];
    else if (a === '--actor') out.actor = argv[++i];
    else if (a === '--role') out.role = argv[++i];
    else if (a === '--reason') out.reason = argv[++i];
    else if (a === '--evidence') out.evidence = argv[++i];
    else if (a === '--transcript-path') out.transcriptPath = argv[++i];
    else if (a === '--cwd') out.cwd = argv[++i];
    else if (a === '--project-root') out.projectRoot = argv[++i];
    else if (a === '--budget-profile') out.budgetProfile = argv[++i];
    else if (a === '--set-pipeline-track') out.setPipelineTrack = argv[++i];
    else if (a === '--track') out.track = argv[++i];
    else if (a === '--skill') out.skill = argv[++i];
    else if (a === '--verify') out.verify = argv[++i];
    else if (a === '--acceptance-command') out.acceptanceCommand = argv[++i];
    else if (a === '--acceptance-cwd') out.acceptanceCwd = argv[++i];
    else if (a === '--files') out.files = argv[++i];
    else if (a === '--allow-manual') out.allowManual = true;
    else if (a === '--decision') out.decision = argv[++i];
    else if (a === '--note') out.note = argv[++i];
    else if (a === '--base') out.base = argv[++i];
    else if (a === '--write') out.write = true;
    else if (a === '--journal') out.journal = true;
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

async function runApprove(args, pluginRoot) {
  const {
    detectAgentContext,
    resolveUserIdentity,
    recordApproval,
    DECISION_TARGET,
  } = require('./lib/approval/human-approval.cjs');
  const { collectRiskFlags, formatRiskFlags } = require('./lib/approval/risk-flags.cjs');

  const refusal = detectAgentContext({ env: process.env, isTTY: Boolean(process.stdin.isTTY) });
  if (refusal) fail(`refusing approval: ${refusal}`, 3, { code: 'AGENT_CONTEXT' });

  const wdArg = args.workDir || process.env.AGENTIC_SWE_WORK_DIR;
  if (!wdArg) fail('approve requires --work-dir (or AGENTIC_SWE_WORK_DIR)', 2);
  const workDir = path.resolve(wdArg);
  if (!DECISION_TARGET[args.decision]) {
    fail(`approve requires --decision ${Object.keys(DECISION_TARGET).join('|')}`, 2);
  }
  const loaded = loadWorkItem(workDir, pluginRoot);
  if (!loaded.ok) fail(loaded.message, 1, loaded);
  if (loaded.state.current_state !== 'approval-wait') {
    fail(`work item is at ${loaded.state.current_state}, not approval-wait`, 1, { code: 'NOT_AT_APPROVAL_WAIT' });
  }
  const cwd = path.resolve(args.cwd || projectRootFromWorkDir(workDir));
  const identity = resolveUserIdentity({ cwd });
  if (!identity) fail('cannot resolve your identity (set git user.email)', 1, { code: 'NO_IDENTITY' });

  const risk = collectRiskFlags({ cwd, base: args.base });
  const prLinkPath = path.join(workDir, 'pr-link.txt');
  const prLink = fs.existsSync(prLinkPath) ? fs.readFileSync(prLinkPath, 'utf8').trim() : '(no pr-link.txt)';
  process.stderr.write(`\nWork item: ${loaded.state.work_id}\nPR: ${prLink}\nApprover: ${identity.actor}\n`);
  process.stderr.write(risk.ok ? `\n${formatRiskFlags(risk)}\n\n` : `\nRisk flags unavailable: ${risk.message}\n\n`);

  const readline = require('node:readline/promises');
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const typed = await rl.question(`Type the work id to record "${args.decision}": `);
  rl.close();
  if (typed.trim() !== loaded.state.work_id) fail('confirmation did not match the work id; nothing recorded', 1, { code: 'NOT_CONFIRMED' });

  const r = recordApproval({ workDir, pluginRoot, decision: args.decision, note: args.note, identity, risk });
  if (!r.ok) fail(r.message, 1, r);
  if (args.json) printJson(r);
  else console.log('OK', r.decision, '→', r.current_state, 'by', identity.actor);
}

function main() {
  const args = parseArgs(process.argv);
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const cmd = args.command;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(`agentic-swe work-engine

Commands:
  init --id <id> [--task "…"] [--work-root <dir>] [--plugin-root <pack>] [--json]
      New work items default pipeline.track to lean unless --budget-profile is set.
  status [--project-root <abs>] [--work-dir <.worklogs/id>]
      One-block status: work id, track, state, last verify exit.
  validate --work-dir <.worklogs/id> [--plugin-root <pack>] [--json]
  verify-journal --work-dir <.worklogs/id> [--json]
  recover --work-dir <.worklogs/id> [--json]
      Rebuild state.json from the journal when the state file is corrupt.
  migrate --journal --work-dir <.worklogs/id> [--json]
      Genesis history.imported event for a work item that predates the journal.
  record-spawn --work-dir <.worklogs/id> --role <id> [--actor <id>] [--json]
      Only writer of counters.panel_runs (role "panel" or "panel:…") and counters.subagent_spawns.
  budget   --work-dir <.worklogs/id> [--plugin-root <pack>] [--json]
  plan-transition --work-dir <dir> --to <state> [--from <state>] [--evidence a,b] [--json]
  risk-flags [--base origin/main] [--cwd <repo>] [--work-dir <dir>] [--write] [--json]
      Flag security-sensitive paths, new dependencies and permission changes in base...HEAD.
  approve --work-dir <dir> --decision approved|changes_requested [--note "…"] [--base ref] [--json]
      Human-only: refuses agent sessions and non-TTY stdin, shows risk flags, asks you to type the work id.
      Leaving approval-wait any other way fails with HUMAN_APPROVAL_REQUIRED.
  waive-track --work-dir <dir> --reason "…" [--json]
      Human-only. Records pipeline.track_waiver { actor: "user:…", reason, at } so a later transition may set a lower track.
  transition --work-dir <dir> --to <state> --actor <id> [--from …] [--reason …] [--evidence …] [--acceptance-command "…"] [--dry-run] [--no-decrement-budget] [--skip-muscle-memory] [--json]
      validation → pr-creation runs pipeline.acceptance_command (or --acceptance-command) and refuses a non-zero exit.
  record-cost --transcript-path <abs.jsonl> [--work-dir <.worklogs/id>] [--project-root <abs>] [--cwd <project>] [--dry-run] [--json]
      (omit --work-dir to use AGENTIC_SWE_WORK_DIR or discover under project root: --project-root, AGENTIC_SWE_PROJECT_ROOT, --cwd, then pwd)
  init … [--budget-profile lean|standard|rigorous]  (sets iteration/cost ceilings + budget.policy from config; optional early pipeline.track)
  apply-budget-profile --work-dir <dir> --track lean|standard|rigorous [--json]
  transition … [--set-pipeline-track lean|standard|rigorous]  (when leaving lean-track-check; merges track budgets from config. Elsewhere only a lower track is accepted, and only with a track_waiver from waive-track)
  doctor [--project-root <abs>] [--plugin-root <pack>] [--json]
  skill-check --skill <name> [--allow-manual] [--json]
  descent-try [--verify "cmd"] [--work-dir <dir>] [--files a,b] [--json]
      Attempt L0 recorded procedure replay before frontier execution; records tier telemetry.
      Optional --files overrides design/implementation declared paths (holdout task keys, etc).
  replay-pack --work-dir <dir> [--json]
      Zero-LLM replay of context-pack.json (declared files + primary verify only).
  descent-capture --work-dir <dir> [--project-root <abs>] [--auto-l0] [--json]
      Capture verify procedure from approved validation-results.md into descent store.
  migrate --journal --work-dir <.worklogs/id> [--json]
      Genesis history.imported event for a work item that predates the journal.
  migrate [--apply] …
      Delegates to scripts/migrate-work-state.js (same flags as that script).
`);
    process.exit(0);
  }

  if (cmd === 'migrate' && args.journal) {
    if (!args.workDir) fail('migrate --journal requires --work-dir', 2);
    const journalWorkDir = path.resolve(args.workDir);
    const { commitState, readJournal } = require('./lib/work-engine/journal.cjs');
    const { withWriteLockSync } = require('./lib/work-engine/state-lock.cjs');
    const existing = readJournal(journalWorkDir);
    if (!existing.ok) fail(`FAILED at seq ${existing.seq}`, 1);
    if (existing.events.length) {
      const out = { ok: true, migrated: false, events: existing.events.length };
      if (args.json) printJson(out);
      else console.log('journal present', existing.events.length);
      return;
    }
    const loaded = loadWorkItem(journalWorkDir, pluginRoot);
    if (!loaded.ok) {
      if (args.json) printJson(loaded);
      else fail(loaded.message, 1, loaded);
      process.exit(1);
    }
    let snapshot;
    withWriteLockSync(journalWorkDir, () => {
      snapshot = commitState(journalWorkDir, loaded.state, { type: 'history.imported', integrity: 'unverified-import' });
      fs.writeFileSync(path.join(journalWorkDir, 'state.json'), JSON.stringify(snapshot, null, 2) + '\n');
    });
    const out = { ok: true, migrated: true, integrity: 'unverified-import' };
    if (args.json) printJson(out);
    else console.log('migrated', snapshot.journal.seq);
    return;
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
    const { checkMuscleMemoryReadiness } = require('./lib/doctor/muscle-memory-doctor.cjs');
    const muscleMemory = checkMuscleMemoryReadiness({
      projectRoot,
      pluginRoot: pluginRootResolved,
    });
    const exitCode = activeWorkDir && (!schemaOk || !budgetOk) ? 1 : 0;
    const report = {
      ok: exitCode === 0 && muscleMemory.ok,
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
      muscle_memory: muscleMemory,
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
      console.log(
        'muscle_memory',
        muscleMemory.ok ? 'ok' : 'issues',
        `consumer_mode=${muscleMemory.consumer_mode}`
      );
      if (muscleMemory.skill_eval?.promote_candidates?.length) {
        console.log('skill_eval_promote_candidates', muscleMemory.skill_eval.promote_candidates.join(', '));
      }
      if (muscleMemory.fleet_evidence) {
        const fe = muscleMemory.fleet_evidence;
        console.log(
          'fleet_evidence',
          `organic_live=${fe.organic_live}`,
          `tier_totals_items=${fe.tier_totals_work_items}`,
          `portfolio=${(fe.portfolio_multiplier * 100).toFixed(3)}%`,
          `submission_ready=${fe.fleet_submission_ready}`
        );
        for (const b of fe.blockers || []) console.log(`  fleet_blocker: ${b}`);
        if (fe.next_command) console.log('fleet_next:', fe.next_command);
      }
      for (const c of muscleMemory.checks) {
        if (c.ok === false) console.log(`  FAIL ${c.id}`);
      }
    }
    process.exit(report.ok ? 0 : 1);
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
      state.pipeline = state.pipeline || {};
      state.pipeline.track = 'lean';
      applyTrackBudgetProfile(state, 'lean', mergedInit, { updateMoney: true });
    }
    const { commitState } = require('./lib/work-engine/journal.cjs');
    const snapshot = commitState(workDir, state, { type: 'init', at: nowIso });
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(snapshot, null, 2) + '\n');
    fs.copyFileSync(progressTpl, path.join(workDir, 'progress.md'));
    fs.copyFileSync(auditTpl, path.join(workDir, 'audit.log'));
    const out = { ok: true, workDir, id: args.id };
    if (args.json) printJson(out);
    else console.log(workDir);
    return;
  }

  if (cmd === 'status') {
    const { discoverActiveWorkDirWithMeta } = require('./lib/work-engine/discover-workdir.cjs');
    const projectRoot = path.resolve(
      args.projectRoot || process.env.AGENTIC_SWE_PROJECT_ROOT || args.cwd || process.cwd()
    );
    const workDirResolved = args.workDir
      ? path.resolve(args.workDir)
      : process.env.AGENTIC_SWE_WORK_DIR
        ? path.resolve(process.env.AGENTIC_SWE_WORK_DIR)
        : discoverActiveWorkDirWithMeta(projectRoot).workDir;
    if (!workDirResolved || !fs.existsSync(path.join(workDirResolved, 'state.json'))) {
      const empty = { ok: true, active: false, summary: 'Active work: none\nTrack: none\nState: none\nLast verify exit: none' };
      if (args.json) printJson(empty);
      else console.log(empty.summary);
      return;
    }
    const loaded = loadWorkItem(workDirResolved, pluginRoot);
    if (!loaded.ok) {
      if (args.json) printJson(loaded);
      else fail(loaded.message, 1, loaded);
      process.exit(1);
    }
    const state = loaded.state;
    let verifyExit = 'none';
    const verifyPath = path.join(workDirResolved, 'verify-result.json');
    if (fs.existsSync(verifyPath)) {
      try {
        const verify = JSON.parse(fs.readFileSync(verifyPath, 'utf8'));
        verifyExit = String(verify.exit_code);
      } catch {
        verifyExit = 'unreadable';
      }
    }
    const summary = [
      `Active work: ${state.work_id || path.basename(workDirResolved)}`,
      `Track: ${(state.pipeline && state.pipeline.track) || 'unset'}`,
      `State: ${state.current_state}`,
      `Last verify exit: ${verifyExit}`,
    ].join('\n');
    if (args.json) {
      printJson({
        ok: true,
        active: true,
        work_id: state.work_id || path.basename(workDirResolved),
        track: (state.pipeline && state.pipeline.track) || null,
        current_state: state.current_state,
        verify_exit: verifyExit,
        summary,
      });
    } else {
      console.log(summary);
    }
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

  if (cmd === 'risk-flags') {
    const { collectRiskFlags, formatRiskFlags } = require('./lib/approval/risk-flags.cjs');
    const wd = args.workDir || process.env.AGENTIC_SWE_WORK_DIR;
    const cwd = path.resolve(args.cwd || (wd ? projectRootFromWorkDir(path.resolve(wd)) : process.cwd()));
    const r = collectRiskFlags({ cwd, base: args.base });
    if (!r.ok) fail(r.message, 1, r);
    if (args.write) {
      if (!wd) fail('risk-flags --write needs --work-dir or AGENTIC_SWE_WORK_DIR', 2);
      const { RISK_FILE } = require('./lib/approval/human-approval.cjs');
      fs.writeFileSync(
        path.join(path.resolve(wd), RISK_FILE),
        JSON.stringify({ generated_at: new Date().toISOString(), ...r }, null, 2) + '\n'
      );
    }
    if (args.json) printJson(r);
    else console.log(formatRiskFlags(r));
    return;
  }

  if (cmd === 'approve') {
    runApprove(args, pluginRoot).catch((e) => fail(String(e && e.message ? e.message : e), 1));
    return;
  }

  if (cmd === 'waive-track') {
    const { detectAgentContext, resolveUserIdentity } = require('./lib/approval/human-approval.cjs');
    const { recordTrackWaiver } = require('./lib/work-engine/track-guard.cjs');
    const refusal = detectAgentContext({ env: process.env, isTTY: Boolean(process.stdin.isTTY) });
    if (refusal) fail(`refusing track waiver: ${refusal}`, 3, { code: 'AGENT_CONTEXT' });
    const wdArg = args.workDir || process.env.AGENTIC_SWE_WORK_DIR;
    if (!wdArg) fail('waive-track requires --work-dir (or AGENTIC_SWE_WORK_DIR)', 2);
    const identity = resolveUserIdentity({ cwd: path.resolve(args.cwd || process.cwd()) });
    if (!identity) fail('cannot resolve your identity (set git user.email)', 1, { code: 'NO_IDENTITY' });
    const r = recordTrackWaiver({
      workDir: path.resolve(wdArg),
      pluginRoot,
      reason: args.reason,
      identity,
    });
    if (!r.ok) fail(r.message, 1, r);
    if (args.json) printJson(r);
    else console.log('OK', r.track_waiver.actor, r.track_waiver.reason);
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

  if (cmd === 'verify-journal') {
    const { verifyWorkJournal } = require('./lib/work-engine/journal.cjs');
    const v = verifyWorkJournal(workDir);
    if (!v.ok) {
      const payload = { ok: false, code: 'INTEGRITY_FAILED', message: `FAILED at seq ${v.seq}`, seq: v.seq };
      if (args.json) printJson(payload);
      else console.error(payload.message);
      process.exit(1);
    }
    const out = { ok: true, integrity: v.missing ? 'unanchored' : 'verified', events: v.events.length };
    if (args.json) printJson(out);
    else console.log(out.integrity, out.events);
    return;
  }

  if (cmd === 'recover') {
    const { recoverState } = require('./lib/work-engine/journal.cjs');
    const r = recoverState(workDir);
    if (!r.ok) {
      if (args.json) printJson(r);
      else console.error(r.message);
      process.exit(1);
    }
    const out = { ok: true, current_state: r.state.current_state };
    if (args.json) printJson(out);
    else console.log('recovered', r.state.current_state);
    return;
  }

  if (cmd === 'record-spawn') {
    if (!args.role) fail('record-spawn requires --role', 2);
    const r = recordSpawn({ workDir, pluginRoot, role: args.role, actor: args.actor || 'work-engine' });
    if (!r.ok) {
      if (args.json) printJson(r);
      else fail(r.message || 'record-spawn failed', 1, r);
      process.exit(1);
    }
    const counters = r.state.counters || {};
    const out = { ok: true, role: args.role, panel_runs: counters.panel_runs || 0, subagent_spawns: counters.subagent_spawns || 0 };
    if (args.json) printJson(out);
    else console.log('RECORDED', args.role, JSON.stringify(out));
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

    const loadedBefore = loadWorkItem(workDir, pluginRoot);
    const fromState =
      args.from != null ? args.from : loadedBefore.ok ? loadedBefore.state.current_state : null;

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
      acceptanceCommand: args.acceptanceCommand,
      acceptanceCwd: args.acceptanceCwd,
      skipMuscleMemory: args.skipMuscleMemory,
    });

    if (!r.ok) {
      if (args.json) printJson(r);
      else fail(r.message || 'transition failed', 1, r);
      process.exit(1);
    }

    const toState = r.state ? r.state.current_state : r.nextState.current_state;

    const out = {
      ok: true,
      current_state: toState,
      dryRun: !!r.dryRun,
      muscle_memory_warning: r.muscle_memory_warning || undefined,
    };
    if (args.json) printJson(out);
    else {
      console.log('OK', out.current_state, r.dryRun ? '(dry-run)' : '');
      if (r.muscle_memory_warning) console.error('WARN', r.muscle_memory_warning);
    }
    return;
  }

  if (cmd === 'replay-pack') {
    if (!args.workDir) fail('replay-pack requires --work-dir', 2);
    const { spawnSync } = require('node:child_process');
    const extra = ['--work-dir', path.resolve(args.workDir)];
    if (args.json) extra.push('--json');
    if (args.projectRoot) extra.push('--project-root', path.resolve(args.projectRoot));
    const r = spawnSync(process.execPath, [path.join(__dirname, 'replay-context-pack.cjs'), ...extra], {
      encoding: 'utf8',
    });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(r.status === null ? 1 : r.status);
  }

  if (cmd === 'descent-try') {
    const { spawnSync } = require('node:child_process');
    const script = path.join(__dirname, 'descent-try.cjs');
    const extra = args.json ? ['--json'] : [];
    if (args.verify) extra.push('--verify', args.verify);
    if (args.workDir) extra.push('--work-dir', path.resolve(args.workDir));
    if (args.projectRoot) extra.push('--project-root', path.resolve(args.projectRoot));
    if (args.files) extra.push('--files', args.files);
    extra.push('--plugin-root', pluginRoot);
    const r = spawnSync(process.execPath, [script, ...extra], { encoding: 'utf8' });
    if (args.json && r.stdout) process.stdout.write(r.stdout);
    else if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    process.exit(r.status === null ? 1 : r.status);
  }

  if (cmd === 'descent-capture') {
    if (!args.workDir) fail('descent-capture requires --work-dir', 2);
    const { captureProcedureFromWork } = require('./lib/descent/capture-procedure.cjs');
    const wd = path.resolve(args.workDir);
    const proj = path.resolve(args.projectRoot || projectRootFromWorkDir(wd));
    const r = captureProcedureFromWork({
      workDir: wd,
      projectRoot: proj,
      storeRoot: pluginRoot,
      autoL0: process.argv.includes('--auto-l0'),
    });
    if (args.json) printJson(r);
    else if (r.ok) console.log('CAPTURED', r.tier, r.fingerprint?.slice(0, 12), r.verifyCommand);
    else console.error('SKIP', r.reason);
    process.exit(r.ok ? 0 : 1);
  }

  if (cmd === 'skill-check') {
    const { checkSkillEvalGate } = require('./lib/skills/eval-gate.cjs');
    if (!args.skill) fail('skill-check requires --skill', 2);
    const gate = checkSkillEvalGate({
      pluginRoot,
      skillName: args.skill,
      autonomous: !args.allowManual,
    });
    const out = { ok: gate.allowed, skill: args.skill, eval_status: gate.eval_status, reason: gate.reason };
    if (args.json) printJson(out);
    else if (gate.allowed) console.log('OK', args.skill, gate.eval_status || 'unknown');
    else console.error('BLOCKED', gate.reason);
    process.exit(gate.allowed ? 0 : 1);
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
      setPipelineTrack: args.setPipelineTrack,
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
