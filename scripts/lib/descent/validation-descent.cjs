'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { recordDescentTierUsage } = require('./record-descent-tier.cjs');
const {
  isValidationApproved,
  resolveVerifyCommand,
} = require('./capture-procedure.cjs');
const { extractDeclaredFiles } = require('../scope/diff-scope-check.cjs');
const { projectRootFromWorkDir } = require('../work-engine/budget-config.cjs');
const { tryLadderThenOverlap } = require('./overlap-procedure.cjs');

/**
 * On validation approval, attempt descent ladder and record tier_totals on the work item.
 * @param {{ workDir: string, pluginRoot: string, projectRoot?: string }} opts
 */
async function runDescentOnValidationApproval(opts) {
  const workDir = path.resolve(opts.workDir);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot || projectRootFromWorkDir(workDir));
  const workId = path.basename(workDir);

  const validationPath = path.join(workDir, 'validation-results.md');
  if (!fs.existsSync(validationPath)) {
    return { ok: false, reason: 'validation-results.md missing' };
  }
  const validationContent = fs.readFileSync(validationPath, 'utf8');
  if (!isValidationApproved(validationContent)) {
    return { ok: false, reason: 'validation not approved' };
  }

  const statePath = path.join(workDir, 'state.json');
  let state = {};
  if (fs.existsSync(statePath)) {
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      /* ignore */
    }
  }

  const implPath = path.join(workDir, 'implementation.md');
  const implementationContent = fs.existsSync(implPath)
    ? fs.readFileSync(implPath, 'utf8')
    : '';

  const verifyCommand = resolveVerifyCommand({ validationContent, state, implementationContent });
  const cwd = state.pipeline?.worktree_path
    ? path.resolve(projectRoot, state.pipeline.worktree_path)
    : projectRoot;

  const designPath = path.join(workDir, 'design.md');
  const declared =
    extractDeclaredFiles(implPath) ||
    (fs.existsSync(designPath) ? extractDeclaredFiles(designPath) : null);
  const files =
    declared && declared.size > 0 ? [...declared].sort().slice(0, 24) : [workId];

  const storeRoot = path.resolve(opts.procedureStoreRoot || projectRoot);
  const { descent, overlap, hit } = await tryLadderThenOverlap({
    projectRoot,
    pluginRoot,
    storeRoot,
    verifyCommand,
    files,
    cwd,
    skipL2: false,
    strictFingerprint: false,
  });

  let tierRecord = null;
  try {
    tierRecord = recordDescentTierUsage({
      workDir,
      pluginRoot,
      tier: descent.tier || 'L3',
      hit: hit || descent.ok === true,
      source: hit && overlap ? 'git-or-transcript-overlap' : 'validation-approved',
    });
  } catch {
    /* optional */
  }

  return {
    ok: descent.ok === true,
    tier: descent.tier,
    verifyCommand: overlap ? overlap.procedure?.verify?.[0]?.command || verifyCommand : verifyCommand,
    overlap_source: hit && overlap ? overlap.procedure?._meta?.source || null : null,
    files,
    delivered_tokens: descent.delivered_tokens,
    frontier_tokens: descent.frontier_tokens,
    tier_record: tierRecord,
    descent,
  };
}

module.exports = { runDescentOnValidationApproval };
