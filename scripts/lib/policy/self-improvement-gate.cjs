'use strict';

/**
 * AE-035b follow-up (M4 audit item 5 / §15): PDP deny merge/deploy/publish for
 * self-improvement work unless a human approval record exists on disk.
 *
 * Grants are never taken from caller input (`authorized`, flags, toolInput).
 * Disk source: `.worklogs/<id>/authorization-record.json` with `user:` actors
 * (same shape as `work authorize`). Fail closed when the work dir or record
 * is missing/unreadable.
 *
 * Layer: policy (core). Does not import improvement (service).
 */

const fs = require('node:fs');
const path = require('node:path');
const { readAuthorizations, privilegedActions } = require('./roles.cjs');
const { extractCommand } = require('./runtime.cjs');

const MODE = 'self-improvement';

/** Tool / op names that are merge, deploy, or release publication. */
const MERGE_DEPLOY_PUBLISH_NAMES = new Set([
  'github.merge',
  'mergePullRequest',
  'mergePR',
  'merge',
  'selfMerge',
  'deploy',
  'production_deployment',
  'npm.publish',
  'npmPublish',
  'release_publication',
  'protected_branch_merge',
]);

const GH_PR_MERGE_RE =
  /(?:^|[\s;&|(])gh\s+(?:-R\s+\S+\s+|--repo\s+\S+\s+)?pr\s+merge\b/;
const NPM_PUBLISH_RE =
  /(?:^|[\s;&|(])(?:(?:npm|pnpm)\s+(?:[^\n]*\s)?publish|yarn\s+(?:npm\s+)?publish)(?=\s|$|[;&|)])/;
const MCP_MERGE_RE =
  /(?:^|_)(?:merge)_(?:[a-z_]*_)?pull_request|pull_request_merge|mergePullRequest$/i;

/**
 * @param {object} input PDP evaluate input
 * @returns {boolean}
 */
function isSelfImprovementContext(input = {}) {
  if (input.mode === MODE) return true;
  if (input.flags && (input.flags.self_improvement === true || input.flags.improvement === true)) {
    return true;
  }
  if (input.actor && typeof input.actor === 'object') {
    if (input.actor.mode === MODE) return true;
    if (input.actor.kind === 'improvement' || input.actor.role === 'improvement') return true;
  }
  const workDir = typeof input.workDir === 'string' ? input.workDir.trim() : '';
  if (!workDir) return false;
  try {
    const raw = fs.readFileSync(path.join(workDir, 'state.json'), 'utf8');
    const state = JSON.parse(raw);
    return Boolean(state && state.mode === MODE);
  } catch {
    // Unreadable state while mode was not otherwise declared → not self-improvement.
    return false;
  }
}

/**
 * Whether this call is a merge, deploy, or publish/release action.
 * Broader than §15 `protected_branch_merge` (which requires protected:true).
 * @param {object} ctx
 * @returns {boolean}
 */
function isMergeDeployPublishAction(ctx = {}) {
  const toolName = ctx.toolName != null ? String(ctx.toolName).trim() : '';
  const op = ctx.op != null ? String(ctx.op).trim() : '';
  if (MERGE_DEPLOY_PUBLISH_NAMES.has(toolName) || MERGE_DEPLOY_PUBLISH_NAMES.has(op)) {
    return true;
  }
  if (ctx.flags) {
    if (
      ctx.flags.protected_branch_merge ||
      ctx.flags.production_deployment ||
      ctx.flags.release_publication
    ) {
      return true;
    }
  }
  if (toolName && /deploy/i.test(toolName) && /prod|production|release/i.test(toolName)) {
    return true;
  }
  if (toolName && MCP_MERGE_RE.test(toolName)) return true;
  if (toolName && /npm\.?publish/i.test(toolName)) return true;

  const command =
    typeof ctx.command === 'string'
      ? ctx.command
      : extractCommand(toolName, ctx.toolInput && typeof ctx.toolInput === 'object' ? ctx.toolInput : {});
  if (typeof command === 'string' && command) {
    if (GH_PR_MERGE_RE.test(command)) return true;
    if (NPM_PUBLISH_RE.test(command)) return true;
  }

  // Privileged publish / PR-write that is merge-shaped (shell or typed).
  const priv = privilegedActions(toolName, ctx.toolInput || {});
  if (priv.includes('npm.publish')) return true;
  if (priv.includes('github.pr.write') && typeof command === 'string' && GH_PR_MERGE_RE.test(command)) {
    return true;
  }
  return false;
}

/**
 * Disk-only human approval. Never trusts caller-supplied grants.
 * @param {string|null|undefined} workDir
 * @returns {{ ok: boolean, reason: string, actions?: string[] }}
 */
function readDiskHumanApproval(workDir) {
  if (!workDir || typeof workDir !== 'string' || !workDir.trim()) {
    return {
      ok: false,
      reason: 'self-improvement merge/deploy/publish requires a workDir with a human authorization record',
    };
  }
  const abs = path.resolve(workDir.trim());
  const auth = readAuthorizations(abs);
  if (auth.error) {
    return { ok: false, reason: `authorization record unreadable (fail closed): ${auth.error}` };
  }
  if (!auth.actions || auth.actions.size === 0) {
    return {
      ok: false,
      reason:
        'self-improvement merge/deploy/publish denied without a disk human authorization record (user: grant via `work authorize`)',
    };
  }
  return { ok: true, reason: 'disk human authorization present', actions: [...auth.actions] };
}

/**
 * Evaluate the self-improvement merge/deploy gate.
 * @param {object} input
 * @returns {null | { decision: 'deny'|'require_approval', rule_id: string, reason: string, code: string }}
 */
function evaluateSelfImprovementMergeDeploy(input = {}) {
  if (!isSelfImprovementContext(input)) return null;
  const toolName = input.toolName != null ? String(input.toolName) : '';
  const command = extractCommand(
    toolName,
    input.toolInput && typeof input.toolInput === 'object' ? input.toolInput : {}
  );
  if (
    !isMergeDeployPublishAction({
      toolName,
      op: input.op,
      flags: input.flags,
      toolInput: input.toolInput,
      command,
    })
  ) {
    return null;
  }

  const approval = readDiskHumanApproval(input.workDir);
  if (!approval.ok) {
    return {
      decision: 'deny',
      rule_id: 'section15.self_improvement_merge_deploy',
      reason: approval.reason,
      code: 'SECTION15_DENY',
    };
  }
  // Human record present → same decision class as §15 protected merge/deploy/publish.
  return {
    decision: 'require_approval',
    rule_id: 'section15.self_improvement_merge_deploy',
    reason:
      '§15 self-improvement merge/deploy/publish: human authorization on disk; still requires human approval (FD-B)',
    code: 'SECTION15_APPROVAL',
  };
}

module.exports = {
  MODE,
  MERGE_DEPLOY_PUBLISH_NAMES,
  isSelfImprovementContext,
  isMergeDeployPublishAction,
  readDiskHumanApproval,
  evaluateSelfImprovementMergeDeploy,
};
