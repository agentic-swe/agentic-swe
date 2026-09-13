'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { recordDescentTierUsage } = require('./record-descent-tier.cjs');
const { resolveVerifyCommand } = require('./capture-procedure.cjs');
const { extractDeclaredFiles } = require('../scope/diff-scope-check.cjs');
const { projectRootFromWorkDir } = require('../work-engine/budget-config.cjs');
const { tryLadderThenOverlap, procedureVerifyCommand } = require('./overlap-procedure.cjs');

/**
 * Descent at implementation entry: fingerprint-only L0/L1 (no verify-only L0, no L2).
 * skip_llm_exploration is set only when a scoped procedure actually hits.
 * @param {{ workDir: string, pluginRoot: string, projectRoot?: string }} opts
 */
async function runDescentOnImplementationEntry(opts) {
  const workDir = path.resolve(opts.workDir);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot || projectRootFromWorkDir(workDir));
  const storeRoot = path.resolve(opts.procedureStoreRoot || projectRoot);
  const workId = path.basename(workDir);

  const statePath = path.join(workDir, 'state.json');
  let state = {};
  if (fs.existsSync(statePath)) {
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      /* ignore */
    }
  }

  const designPath = path.join(workDir, 'design.md');
  const stubsPath = path.join(workDir, 'test-stubs.md');
  const implPath = path.join(workDir, 'implementation.md');
  const designContent = fs.existsSync(designPath) ? fs.readFileSync(designPath, 'utf8') : '';
  const stubsContent = fs.existsSync(stubsPath) ? fs.readFileSync(stubsPath, 'utf8') : '';
  const implementationContent = fs.existsSync(implPath) ? fs.readFileSync(implPath, 'utf8') : '';

  const verifyCommand = resolveVerifyCommand({
    validationContent: `${stubsContent}\n${designContent}`,
    state,
    implementationContent: implementationContent || designContent,
  });

  const declared = extractDeclaredFiles(designPath) || extractDeclaredFiles(implPath);
  const files = declared && declared.size > 0 ? [...declared].sort().slice(0, 24) : null;
  if (!files || !files.length) {
    let context_pack = null;
    try {
      const { writeContextPack } = require('../context/write-context-pack.cjs');
      context_pack = writeContextPack({ workDir, projectRoot, pluginRoot });
    } catch {
      /* optional */
    }
    return { ok: false, reason: 'no declared files — refuse verify-only skip of implementation', context_pack };
  }

  const cwd = state.pipeline?.worktree_path
    ? path.resolve(projectRoot, state.pipeline.worktree_path)
    : projectRoot;

  const { descent, overlap, hit, overlap_rerun: overlapRerun } = await tryLadderThenOverlap({
    projectRoot,
    pluginRoot,
    storeRoot,
    verifyCommand,
    files,
    cwd,
    strictFingerprint: true,
    skipL2: true,
  });
  const skipLlm = hit;
  const usedVerify = (hit && overlap && procedureVerifyCommand(overlap)) || verifyCommand;

  let tierRecord = null;
  try {
    tierRecord = recordDescentTierUsage({
      workDir,
      pluginRoot,
      tier: descent.tier || 'L3',
      hit,
      source: hit && overlap && overlapRerun ? 'team-overlap' : 'implementation-entry',
      metricsPatch: {
        skip_llm_exploration: skipLlm,
        descent_pre_impl: true,
        descent_verify_command: usedVerify,
        ...(skipLlm && overlap ? { verify_command: usedVerify } : {}),
      },
    });
  } catch {
    /* optional */
  }

  let context_pack = null;
  try {
    const { writeContextPack } = require('../context/write-context-pack.cjs');
    context_pack = writeContextPack({ workDir, projectRoot, pluginRoot });
  } catch {
    /* optional */
  }

  let pack_replay = null;
  if (skipLlm && context_pack && context_pack.ok) {
    try {
      const { replayContextPack, writeDescentReplayArtifact } = require('../context/delegate-from-pack.cjs');
      pack_replay = replayContextPack({
        pack: context_pack.pack,
        workDir,
        projectRoot,
      });
      writeDescentReplayArtifact(workDir, pack_replay);
    } catch {
      /* optional */
    }
  }

  return {
    ok: hit,
    tier: descent.tier,
    skip_llm_exploration: skipLlm,
    verifyCommand: usedVerify,
    design_verify_command: verifyCommand,
    overlap_source: hit && overlap ? overlap.procedure?._meta?.source || null : null,
    files,
    workId,
    delivered_tokens: descent.delivered_tokens,
    frontier_tokens: descent.frontier_tokens,
    tier_record: tierRecord,
    context_pack,
    pack_replay,
    descent,
  };
}

module.exports = { runDescentOnImplementationEntry };
