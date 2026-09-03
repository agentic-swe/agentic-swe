'use strict';

const { executeAction } = require('./replay.cjs');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Isolated verify commands that are safe to execute during mining (single test file).
 * @param {string} command
 * @param {string} projectRoot
 * @returns {string|null} repo-relative test path
 */
function isolatedVerifyRel(command, projectRoot) {
  const t = String(command || '').trim();
  let rel = null;
  const mDash = t.match(/^node\s+--test\s+(\S+)/);
  if (mDash) rel = mDash[1];
  const mNode = t.match(/^node\s+(test\/\S+)/);
  if (!rel && mNode) rel = mNode[1];
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) return null;
  const abs = path.resolve(projectRoot, rel);
  if (!fs.existsSync(abs)) return null;
  return rel;
}

/**
 * Evaluate a mined/captured procedure by running its verify action.
 * @param {{ procedure: object, projectRoot: string, cwd?: string }} opts
 */
function evalProcedureVerify(opts) {
  const procedure = opts.procedure || {};
  const verify = procedure.verify?.[0] || procedure.actions?.[0];
  if (!verify || verify.type !== 'RUN' || !verify.command) {
    return { ok: false, reason: 'no runnable verify action' };
  }

  const projectRoot = opts.projectRoot;
  const cwd = verify.cwd || opts.cwd || projectRoot;
  const r = executeAction(
    { type: 'RUN', command: verify.command, cwd, timeout_ms: opts.timeoutMs || 15000 },
    projectRoot
  );
  return {
    ok: r.ok === true,
    exitCode: r.exitCode,
    command: verify.command,
    cwd,
  };
}

module.exports = { evalProcedureVerify, isolatedVerifyRel };
