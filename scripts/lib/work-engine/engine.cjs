'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { checkBudgets } = require('./budget.cjs');
const { loadMergedBudgetThresholds, getCounterCaps, projectRootFromWorkDir } = require('./budget-config.cjs');
const { counterMismatches, decideSpawn, rejectionCapBlock } = require('./counters.cjs');
const { assertProjection, commitState } = require('./journal.cjs');
const { decideTransition } = require('./decide.cjs');
const { runPostTransitionHooks } = require('./post-transition.cjs');
const { assertTransition } = require('./transitions.cjs');
const { assertArtifactsForTransition } = require('./artifacts.cjs');
const { assertPermissionsGate } = require('./permissions-gate.cjs');
const { assertHumanApprovalGate } = require('../approval/human-approval.cjs');
const { resolveEvidenceRef } = require('./paths.cjs');
const { validateWorkItemSchemaAtRoot } = require('./validate-schema.cjs');

function getDefaultPluginRoot() {
  return path.join(__dirname, '..', '..', '..');
}

function readStatePath(workDir) {
  return path.join(workDir, 'state.json');
}

/**
 * @param {string} workDir absolute path to .worklogs/<id>
 * @param {string} pluginRoot agentic-swe repo root (pack root)
 */
function loadWorkItem(workDir, pluginRoot = getDefaultPluginRoot()) {
  const statePath = readStatePath(workDir);
  let raw;
  try {
    raw = fs.readFileSync(statePath, 'utf8');
  } catch (e) {
    return { ok: false, code: 'READ_ERROR', message: String(e.message) };
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    return { ok: false, code: 'JSON_PARSE', message: 'state.json is not valid JSON' };
  }
  const schema = validateWorkItemSchemaAtRoot(state, pluginRoot);
  if (!schema.ok) {
    return {
      ok: false,
      code: 'SCHEMA_INVALID',
      message: 'state.json failed JSON Schema validation',
      schemaErrors: schema.errors,
    };
  }
  return { ok: true, workDir, pluginRoot, state, statePath };
}

function assertEvidenceRefs(workDir, refs) {
  if (!refs || refs.length === 0) return { ok: true };
  for (const ref of refs) {
    const r = resolveEvidenceRef(workDir, ref);
    if (!r.ok) return { ok: false, code: 'EVIDENCE_PATH', message: r.error };
    try {
      const st = fs.statSync(r.resolved);
      if (!st.isFile() || st.size === 0) {
        return { ok: false, code: 'EVIDENCE_MISSING', message: `evidence file missing or empty: ${ref}` };
      }
    } catch {
      return { ok: false, code: 'EVIDENCE_MISSING', message: `evidence file not found: ${ref}` };
    }
  }
  return { ok: true };
}

/**
 * Validate transition without writing (budget, edge, artifacts, evidence).
 * @param {object} params
 * @param {string} params.workDir
 * @param {string} params.pluginRoot
 * @param {object} params.state
 * @param {string} params.from
 * @param {string} params.to
 * @param {string[]} [params.evidence_refs]
 * @param {{ record: string }} [params.humanApproval] set only by `work approve`
 */
function validateTransition(params) {
  const { workDir, pluginRoot, state, from, to, evidence_refs, humanApproval } = params;
  const projection = assertProjection(workDir, state);
  if (!projection.ok) return projection;

  // A recorded human approval may close the item even when the agent's budget is spent;
  // changes_requested still needs budget because it starts more agent work.
  let humanClose = false;
  if (from === 'approval-wait') {
    const human = assertHumanApprovalGate({ workDir, from, to, state, humanApproval });
    if (!human.ok) return human;
    humanClose = to === 'completed';
  }

  const b = checkBudgets(state, { pluginRoot, workDir });
  if (!b.ok && !humanClose) {
    return { ok: false, code: 'BUDGET_STOP', message: b.errors.join('; '), budget: b };
  }

  const tr = assertTransition(pluginRoot, from, to, state.pipeline && state.pipeline.track);
  if (!tr.ok) {
    return { ok: false, code: tr.code || 'TRANSITION_INVALID', message: tr.message };
  }

  let caps = null;
  if (pluginRoot && workDir) {
    caps = getCounterCaps(loadMergedBudgetThresholds(pluginRoot, projectRootFromWorkDir(workDir)), state);
  }
  const capped = rejectionCapBlock(state, from, to, caps);
  if (capped && !humanClose) return capped;

  const art = assertArtifactsForTransition(workDir, from, to, state);
  if (!art.ok) {
    return { ok: false, code: art.code, message: art.message, missing: art.missing };
  }

  const perm = assertPermissionsGate({ from, to, state });
  if (!perm.ok) {
    return { ok: false, code: perm.code, message: perm.message };
  }

  const ev = assertEvidenceRefs(workDir, evidence_refs);
  if (!ev.ok) return ev;

  return { ok: true, budget: b };
}

/**
 * @param {object} opts
 * @param {string} opts.workDir
 * @param {string} [opts.pluginRoot]
 * @param {string} opts.to
 * @param {string} [opts.from] defaults to state.current_state
 * @param {string} opts.actor
 * @param {string} [opts.reason]
 * @param {string[]} [opts.evidence_refs]
 * @param {boolean} [opts.decrementIterationBudget=true]
 * @param {boolean} [opts.dryRun]
 * @param {string} [opts.setPipelineTrack] when leaving lean-track-check, set pipeline.track before applying profile
 * @param {boolean} [opts.skipMuscleMemory] skip post-transition hooks (descent + procedure capture)
 * @param {string[]} [opts.postTransitionHooks] override DEFAULT_POST_TRANSITION_HOOKS
 */
function applyTransition(opts) {
  const pluginRoot = opts.pluginRoot || getDefaultPluginRoot();
  const loaded = loadWorkItem(opts.workDir, pluginRoot);
  if (!loaded.ok) return loaded;

  const { state, statePath } = loaded;
  const from = opts.from != null ? opts.from : state.current_state;
  const to = opts.to;

  const v = validateTransition({
    workDir: opts.workDir,
    pluginRoot,
    state,
    from,
    to,
    evidence_refs: opts.evidence_refs,
    humanApproval: opts.humanApproval,
  });
  if (!v.ok) return v;

  const { acceptanceCommandFromState, runWorkAcceptance } = require('./acceptance.cjs');
  const acceptanceCommand =
    (opts.acceptanceCommand && String(opts.acceptanceCommand).trim()) ||
    acceptanceCommandFromState(state);
  let acceptanceVerify = null;
  if (from === 'validation' && to === 'pr-creation' && acceptanceCommand && !opts.skipAcceptance) {
    acceptanceVerify = runWorkAcceptance({
      workDir: opts.workDir,
      command: acceptanceCommand,
      cwd: opts.acceptanceCwd || (state.pipeline && state.pipeline.acceptance_cwd) || null,
      write: !opts.dryRun,
    });
    if (!acceptanceVerify.ok) return acceptanceVerify;
  }

  const leavingLeanCheck = from === 'lean-track-check' && Boolean(opts.setPipelineTrack || state.pipeline?.track);
  const { next } = decideTransition({
    state,
    from,
    to,
    now: new Date().toISOString(),
    actor: opts.actor,
    reason: opts.reason,
    evidence_refs: opts.evidence_refs,
    assigned_subagent: opts.assigned_subagent,
    setPipelineTrack: opts.setPipelineTrack,
    acceptanceCommand,
    testsPassed: Boolean(acceptanceVerify && acceptanceVerify.ok && acceptanceVerify.verify),
    budgetThresholds: leavingLeanCheck
      ? loadMergedBudgetThresholds(pluginRoot, projectRootFromWorkDir(opts.workDir))
      : undefined,
    decrementIterationBudget: opts.decrementIterationBudget,
  });

  if (opts.dryRun) {
    return { ok: true, dryRun: true, nextState: next };
  }

  const tmp = `${statePath}.tmp.${process.pid}`;
  const { withWriteLockSync } = require('./state-lock.cjs');
  try {
    withWriteLockSync(opts.workDir, () => {
      const snapshot = commitState(opts.workDir, next, { type: 'transition', expectCurrent: from });
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
      fs.renameSync(tmp, statePath);
    });
  } catch (e) {
    if (e && (e.code === 'LOCK_TIMEOUT' || e.code === 'INTEGRITY_FAILED')) {
      return { ok: false, code: e.code, message: String(e.message) };
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return { ok: false, code: 'WRITE_ERROR', message: String(e.message) };
  }

  let postTransition = null;
  if (!opts.skipMuscleMemory) {
    postTransition = runPostTransitionHooks({
      pluginRoot,
      hooks: opts.postTransitionHooks,
      ctx: { workDir: opts.workDir, pluginRoot, from, to, procedureStoreRoot: opts.procedureStoreRoot },
    });
  }

  const finalState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  let muscleMemoryWarning = null;
  if (
    !opts.dryRun &&
    from === 'validation' &&
    (to === 'pr-creation' || to === 'completed') &&
    !finalState.budget?.tier_totals
  ) {
    muscleMemoryWarning =
      'tier_totals missing after validation transition — run validation-descent or descent-try before fleet submission';
  }

  const result = { ok: true, state: finalState, muscle_memory_warning: muscleMemoryWarning };
  if (postTransition && postTransition.errors.length) result.post_transition_errors = postTransition.errors;
  return result;
}

/**
 * Full validate: schema + budget only (no transition).
 * @param {string} workDir
 * @param {string} [pluginRoot]
 */
function validateWorkDir(workDir, pluginRoot = getDefaultPluginRoot()) {
  const loaded = loadWorkItem(workDir, pluginRoot);
  if (!loaded.ok) return loaded;
  const projection = assertProjection(workDir, loaded.state);
  if (!projection.ok) return projection;
  const b = checkBudgets(loaded.state, { pluginRoot, workDir });
  if (!b.ok) {
    return { ok: false, code: 'BUDGET_STOP', message: b.errors.join('; '), budget: b, state: loaded.state };
  }
  const mismatches = counterMismatches(loaded.state);
  if (mismatches.length) {
    const detail = mismatches
      .map((m) => `counters.${m.key}=${m.stored} but history implies ${m.expected}`)
      .join('; ');
    return { ok: false, code: 'COUNTER_MISMATCH', message: detail, mismatches, state: loaded.state };
  }
  return { ok: true, state: loaded.state };
}

/**
 * Record one panel run or subagent spawn. This is the only writer of
 * `panel_runs` and `subagent_spawns`.
 * @param {{ workDir: string, pluginRoot?: string, role: string, actor?: string }} opts
 */
function recordSpawn(opts) {
  const pluginRoot = opts.pluginRoot || getDefaultPluginRoot();
  const loaded = loadWorkItem(opts.workDir, pluginRoot);
  if (!loaded.ok) return loaded;
  if (!opts.role) return { ok: false, code: 'MISSING_ROLE', message: 'record-spawn requires --role' };
  const { next } = decideSpawn(loaded.state, {
    role: opts.role,
    actor: opts.actor,
    now: new Date().toISOString(),
  });
  const tmp = `${loaded.statePath}.tmp.${process.pid}`;
  const { withWriteLockSync } = require('./state-lock.cjs');
  try {
    withWriteLockSync(opts.workDir, () => {
      const snapshot = commitState(opts.workDir, next, {
        type: 'spawn',
        expectCurrent: loaded.state.current_state,
      });
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
      fs.renameSync(tmp, loaded.statePath);
    });
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    if (e && e.code === 'INTEGRITY_FAILED') return { ok: false, code: e.code, message: String(e.message) };
    return { ok: false, code: 'WRITE_ERROR', message: String(e.message) };
  }
  return { ok: true, state: JSON.parse(fs.readFileSync(loaded.statePath, 'utf8')) };
}

module.exports = {
  getDefaultPluginRoot,
  loadWorkItem,
  validateTransition,
  applyTransition,
  validateWorkDir,
  recordSpawn,
  assertEvidenceRefs,
};
