'use strict';

/**
 * §15 restricted-operations catalog (master prompt / AE-022).
 * Each entry maps an action id to a default PDP decision.
 *
 * @typedef {{
 *   id: string,
 *   title: string,
 *   decision: 'deny' | 'require_approval',
 *   match: (ctx: object) => boolean,
 * }} RestrictedOp
 */

/** @type {RestrictedOp[]} */
const RESTRICTED_OPS = [
  {
    id: 'section15.protected_branch_merge',
    title: 'protected-branch merge',
    decision: 'require_approval',
    match: (ctx) =>
      ctx.op === 'protected_branch_merge' ||
      (ctx.toolName === 'github.merge' && ctx.toolInput && ctx.toolInput.protected === true) ||
      Boolean(ctx.flags && ctx.flags.protected_branch_merge),
  },
  {
    id: 'section15.production_deployment',
    title: 'production deployment',
    decision: 'require_approval',
    match: (ctx) =>
      ctx.op === 'production_deployment' ||
      Boolean(ctx.flags && ctx.flags.production_deployment) ||
      (typeof ctx.toolName === 'string' && /deploy.*prod|production.*deploy/i.test(ctx.toolName)),
  },
  {
    id: 'section15.release_publication',
    title: 'release publication',
    decision: 'require_approval',
    // Command-shaped npm publish stays on banned_commands / role rules so existing
    // baseline denials keep their rule ids; use op/flags for the §15 catalog entry.
    match: (ctx) =>
      ctx.op === 'release_publication' || Boolean(ctx.flags && ctx.flags.release_publication),
  },
  {
    id: 'section15.security_policy_change',
    title: 'security policy change',
    decision: 'deny',
    match: (ctx) =>
      ctx.op === 'security_policy_change' ||
      Boolean(ctx.flags && ctx.flags.security_policy_change) ||
      targetsPolicyFiles(ctx),
  },
  {
    id: 'section15.credential_or_permission_change',
    title: 'credential or permission change',
    decision: 'deny',
    match: (ctx) =>
      ctx.op === 'credential_or_permission_change' ||
      Boolean(ctx.flags && ctx.flags.credential_or_permission_change) ||
      targetsCredentialFiles(ctx),
  },
  {
    id: 'section15.destructive_data_operation',
    title: 'destructive data operation',
    decision: 'deny',
    match: (ctx) =>
      ctx.op === 'destructive_data_operation' ||
      Boolean(ctx.flags && ctx.flags.destructive_data_operation) ||
      (typeof ctx.command === 'string' &&
        /\b(DROP\s+(TABLE|DATABASE)|TRUNCATE\s+TABLE)\b/i.test(ctx.command)),
  },
  {
    id: 'section15.public_disclosure_private',
    title: 'public disclosure of private information',
    decision: 'deny',
    match: (ctx) =>
      ctx.op === 'public_disclosure_private' ||
      Boolean(ctx.flags && ctx.flags.public_disclosure_private),
  },
  {
    id: 'section15.paid_commitment_beyond_budget',
    title: 'paid commitment beyond budget',
    decision: 'deny',
    match: (ctx) =>
      ctx.op === 'paid_commitment_beyond_budget' ||
      Boolean(ctx.flags && ctx.flags.paid_commitment_beyond_budget),
  },
  {
    id: 'section15.ai_org_authority_change',
    title: "change to the AI organization's own authority",
    decision: 'deny',
    match: (ctx) =>
      ctx.op === 'ai_org_authority_change' ||
      Boolean(ctx.flags && ctx.flags.ai_org_authority_change) ||
      targetsAuthorityFiles(ctx),
  },
];

function pathList(ctx) {
  const paths = [];
  if (Array.isArray(ctx.paths)) paths.push(...ctx.paths.map(String));
  if (ctx.toolInput && typeof ctx.toolInput === 'object') {
    for (const k of ['file_path', 'path', 'target_file']) {
      if (typeof ctx.toolInput[k] === 'string') paths.push(ctx.toolInput[k]);
    }
  }
  return paths;
}

function targetsPolicyFiles(ctx) {
  return pathList(ctx).some(
    (p) =>
      /(^|\/)(\.agentic-swe\/)?policy\.json$/.test(p) ||
      /(^|\/)config\/default-policy\.json$/.test(p) ||
      /(^|\/)schemas\/agentic-swe-policy\.schema\.json$/.test(p)
  );
}

function targetsCredentialFiles(ctx) {
  return pathList(ctx).some(
    (p) =>
      /(^|\/)\.env(\.|$)/.test(p) ||
      /(^|\/)credentials\.json$/.test(p) ||
      /(^|\/)\.npmrc$/.test(p) ||
      /(^|\/)id_rsa/.test(p)
  );
}

function targetsAuthorityFiles(ctx) {
  return pathList(ctx).some(
    (p) =>
      /(^|\/)config\/roles\//.test(p) ||
      /(^|\/)state-machine\.json$/.test(p) ||
      /(^|\/)goal-state-machine\.json$/.test(p)
  );
}

/**
 * First matching §15 op, or null.
 * @param {object} ctx
 * @returns {RestrictedOp|null}
 */
function matchRestrictedOp(ctx) {
  for (const op of RESTRICTED_OPS) {
    if (op.match(ctx)) return op;
  }
  return null;
}

module.exports = {
  RESTRICTED_OPS,
  matchRestrictedOp,
  targetsPolicyFiles,
  targetsCredentialFiles,
  targetsAuthorityFiles,
};
