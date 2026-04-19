'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { checkBudgets } = require('./budget.cjs');
const {
  loadMergedBudgetThresholds,
  applyTrackBudgetProfile,
  projectRootFromWorkDir,
} = require('./budget-config.cjs');
const { assertTransition } = require('./transitions.cjs');
const { assertArtifactsForTransition } = require('./artifacts.cjs');
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
 */
function validateTransition(params) {
  const { workDir, pluginRoot, state, from, to, evidence_refs } = params;

  const b = checkBudgets(state, { pluginRoot, workDir });
  if (!b.ok) {
    return { ok: false, code: 'BUDGET_STOP', message: b.errors.join('; '), budget: b };
  }

  const tr = assertTransition(pluginRoot, from, to, state.pipeline && state.pipeline.track);
  if (!tr.ok) {
    return { ok: false, code: tr.code || 'TRANSITION_INVALID', message: tr.message };
  }

  const art = assertArtifactsForTransition(workDir, from, to, state);
  if (!art.ok) {
    return { ok: false, code: art.code, message: art.message, missing: art.missing };
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
  });
  if (!v.ok) return v;

  const next = structuredClone(state);
  next.current_state = to;
  next.updated_at = new Date().toISOString();

  if (opts.setPipelineTrack) {
    next.pipeline = next.pipeline || {};
    next.pipeline.track = opts.setPipelineTrack;
  }

  if (from === 'lean-track-check' && next.pipeline && next.pipeline.track) {
    const projectRoot = projectRootFromWorkDir(opts.workDir);
    const merged = loadMergedBudgetThresholds(pluginRoot, projectRoot);
    applyTrackBudgetProfile(next, next.pipeline.track, merged, { updateMoney: true });
  }

  if (opts.decrementIterationBudget !== false && typeof next.budget?.budget_remaining === 'number') {
    next.budget.budget_remaining = Math.max(0, next.budget.budget_remaining - 1);
  }

  const entry = {
    at: next.updated_at,
    actor: opts.actor || 'unknown',
    from,
    to,
  };
  if (opts.reason) entry.reason = opts.reason;
  if (opts.evidence_refs && opts.evidence_refs.length) entry.evidence_refs = opts.evidence_refs;
  if (opts.assigned_subagent) entry.assigned_subagent = opts.assigned_subagent;

  if (!Array.isArray(next.history)) next.history = [];
  next.history.push(entry);

  if (opts.dryRun) {
    return { ok: true, dryRun: true, nextState: next };
  }

  const tmp = `${statePath}.tmp.${process.pid}`;
  const { withWriteLockSync } = require('./state-lock.cjs');
  try {
    withWriteLockSync(opts.workDir, () => {
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
      fs.renameSync(tmp, statePath);
    });
  } catch (e) {
    if (e && e.code === 'LOCK_TIMEOUT') {
      return { ok: false, code: 'LOCK_TIMEOUT', message: String(e.message) };
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return { ok: false, code: 'WRITE_ERROR', message: String(e.message) };
  }

  return { ok: true, state: next };
}

/**
 * Full validate: schema + budget only (no transition).
 * @param {string} workDir
 * @param {string} [pluginRoot]
 */
function validateWorkDir(workDir, pluginRoot = getDefaultPluginRoot()) {
  const loaded = loadWorkItem(workDir, pluginRoot);
  if (!loaded.ok) return loaded;
  const b = checkBudgets(loaded.state, { pluginRoot, workDir });
  if (!b.ok) {
    return { ok: false, code: 'BUDGET_STOP', message: b.errors.join('; '), budget: b, state: loaded.state };
  }
  return { ok: true, state: loaded.state };
}

module.exports = {
  getDefaultPluginRoot,
  loadWorkItem,
  validateTransition,
  applyTransition,
  validateWorkDir,
  assertEvidenceRefs,
};
