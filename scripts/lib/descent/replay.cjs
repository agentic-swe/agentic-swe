'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { recordTierEvent } = require('./tier-telemetry.cjs');
const { canReplay } = require('../memory/trust.cjs');

/**
 * @typedef {{ type: string, command?: string, path?: string, cwd?: string }} TypedAction
 */

/**
 * @param {TypedAction} action
 * @param {string} projectRoot
 * @returns {{ ok: boolean, output?: string, error?: string }}
 */
function executeAction(action, projectRoot) {
  switch (action.type) {
    case 'RUN': {
      const cwd = action.cwd
        ? path.isAbsolute(action.cwd)
          ? action.cwd
          : path.resolve(projectRoot, action.cwd)
        : projectRoot;
      const r = spawnSync(action.command, {
        cwd,
        shell: true,
        encoding: 'utf8',
        timeout: action.timeout_ms || 120000,
      });
      const ok = r.status === 0;
      return {
        ok,
        exitCode: r.status,
        output: (r.stdout || '') + (r.stderr || ''),
        error: ok ? undefined : `exit ${r.status}`,
      };
    }
    case 'READ_FILE': {
      const p = path.resolve(projectRoot, action.path);
      if (!fs.existsSync(p)) return { ok: false, error: 'missing file' };
      return { ok: true, output: fs.readFileSync(p, 'utf8') };
    }
    default:
      return { ok: false, error: `unsupported action type ${action.type}` };
  }
}

/**
 * Replay a recorded procedure; escalate tier on any failure.
 * @param {{ procedure: { preconditions?: TypedAction[], actions: TypedAction[], verify?: TypedAction[] }, projectRoot: string }} opts
 */
function replayProcedure(opts) {
  const root = path.resolve(opts.projectRoot);
  const proc = opts.procedure || { actions: [] };
  const steps = [];

  const trustRecord = opts.record || opts.procedureRecord;
  if (trustRecord && !canReplay(trustRecord)) {
    return {
      ok: false,
      escalate: true,
      tier: 'L3',
      steps,
      reason: 'external memory not promoted',
    };
  }

  for (const pre of proc.preconditions || []) {
    const r = executeAction(pre, root);
    steps.push({ phase: 'precondition', action: pre, ...r });
    if (!r.ok) {
      return { ok: false, escalate: true, tier: 'L2', steps, reason: 'precondition failed' };
    }
  }

  for (const act of proc.actions || []) {
    const r = executeAction(act, root);
    steps.push({ phase: 'action', action: act, ...r });
    if (!r.ok) {
      return { ok: false, escalate: true, tier: 'L2', steps, reason: 'action failed' };
    }
  }

  for (const ver of proc.verify || []) {
    const r = executeAction(ver, root);
    steps.push({ phase: 'verify', action: ver, ...r });
    if (!r.ok) {
      return { ok: false, escalate: true, tier: 'L3', steps, reason: 'verification failed' };
    }
  }

  return { ok: true, escalate: false, tier: 'L0', steps };
}

function replayProcedureWithTelemetry(opts) {
  const r = replayProcedure(opts);
  recordTierEvent(opts.projectRoot, r.tier || 'L3', r.ok);
  return r;
}

module.exports = { replayProcedure, replayProcedureWithTelemetry, executeAction };
