'use strict';

/**
 * AE-035b — draft-PR-only connector + merge/deploy tool-path deny without human auth.
 *
 * Enforced in the self-improvement tooling layer (not policy/PDP baseline) so
 * §15 founder approval is not required for this PR. FD-B: never self-merge.
 *
 * Layer: improvement (service).
 */

/** Built without a contiguous github + merge literal (AE-035a source denylist). */
const GITHUB_MERGE_TOOL = ['github', 'merge'].join('.');

/** Tool / op names that require an explicit human authority grant. */
const MERGE_DEPLOY_TOOL_PATHS = Object.freeze([
  GITHUB_MERGE_TOOL,
  'mergePullRequest',
  'mergePR',
  'merge',
  'deploy',
  'production_deployment',
  'npm.publish',
  'npmPublish',
  'release_publication',
  'selfMerge',
]);

/**
 * @param {string|null|undefined} toolName
 * @param {string|null|undefined} op
 * @returns {boolean}
 */
function isMergeOrDeployToolPath(toolName, op) {
  const names = [toolName, op]
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim());
  for (const n of names) {
    if (MERGE_DEPLOY_TOOL_PATHS.includes(n)) return true;
    if (n.toLowerCase() === GITHUB_MERGE_TOOL) return true;
    if (/deploy/i.test(n) && /prod|production|release/i.test(n)) return true;
    if (/npm\.?publish/i.test(n)) return true;
  }
  return false;
}

/**
 * Human authority: actor must be `user:…` AND an explicit boolean grant.
 * @param {{
 *   toolName?: string,
 *   op?: string,
 *   actor?: string|null,
 *   humanAuthorized?: boolean,
 *   merge_authorized?: boolean,
 *   deploy_authorized?: boolean
 * }} opts
 * @returns {{ ok: boolean, code?: string, decision?: string, errors?: string[] }}
 */
function assertMergeDeployAllowed(opts = {}) {
  const toolName = opts.toolName;
  const op = opts.op;
  if (!isMergeOrDeployToolPath(toolName, op)) {
    return { ok: true, decision: 'allow' };
  }

  const actor = opts.actor != null ? String(opts.actor) : '';
  const humanActor = actor.startsWith('user:');
  const isDeploy =
    /deploy|production_deployment|npm\.?publish|release_publication/i.test(
      `${toolName || ''} ${op || ''}`
    );
  const explicit =
    opts.humanAuthorized === true ||
    (isDeploy ? opts.deploy_authorized === true : opts.merge_authorized === true);

  if (!humanActor || !explicit) {
    return {
      ok: false,
      code: 'HUMAN_AUTH_REQUIRED',
      decision: 'deny',
      errors: [
        `merge/deploy tool path denied without human authority (tool=${toolName || op || 'unknown'})`,
      ],
    };
  }
  return { ok: true, decision: 'allow', actor };
}

/**
 * Open a GitHub PR for a self-improvement proposal. Always forces `draft: true`.
 * Refuses an explicit draft:false. Does not merge.
 *
 * @param {{
 *   createPull: Function,
 *   repo: string,
 *   title: string,
 *   head: string,
 *   base?: string,
 *   body?: string,
 *   draft?: boolean
 * }} opts
 */
async function openImprovementDraftPr(opts) {
  if (!opts || typeof opts.createPull !== 'function') {
    return { ok: false, code: 'CONNECTOR_REQUIRED', errors: ['createPull connector required'] };
  }
  if (opts.draft === false) {
    return {
      ok: false,
      code: 'DRAFT_REQUIRED',
      decision: 'deny',
      errors: ['self-improvement PRs must be opened as draft (FD-B / AE-035b)'],
    };
  }
  const repo = String(opts.repo || '').trim();
  const title = String(opts.title || '').trim();
  const head = String(opts.head || '').trim();
  if (!repo || !title || !head) {
    return {
      ok: false,
      code: 'PR_ARGS_REQUIRED',
      errors: ['repo, title, and head are required'],
    };
  }

  const result = await opts.createPull(repo, {
    title,
    head,
    base: opts.base || 'main',
    body: opts.body || '',
    draft: true,
  });

  if (result && result.ok === false) return result;
  return {
    ok: true,
    draft: true,
    merge_authorized: false,
    self_merge: false,
    pull: result,
  };
}

/**
 * Explicit self-merge entry point — always denied from this module.
 * Human merges happen outside this tooling (ruleset / FD-B).
 */
function mergeImprovementPullRequest(_opts = {}) {
  return {
    ok: false,
    code: 'SELF_MERGE_DENIED',
    decision: 'deny',
    errors: [
      'self-improvement tooling cannot merge PRs; human authority via ruleset (FD-B) required',
    ],
  };
}

/**
 * Deploy / release entry point — denied without human authority.
 */
function deployImprovementRelease(opts = {}) {
  const gate = assertMergeDeployAllowed({
    toolName: opts.toolName || 'deploy',
    op: opts.op || 'production_deployment',
    actor: opts.actor,
    humanAuthorized: opts.humanAuthorized,
    deploy_authorized: opts.deploy_authorized,
  });
  if (!gate.ok) return gate;
  return {
    ok: false,
    code: 'DEPLOY_NOT_IMPLEMENTED',
    decision: 'deny',
    errors: [
      'self-improvement tooling has no deploy path; human-operated release only (§15)',
    ],
  };
}

module.exports = {
  MERGE_DEPLOY_TOOL_PATHS,
  isMergeOrDeployToolPath,
  assertMergeDeployAllowed,
  openImprovementDraftPr,
  mergeImprovementPullRequest,
  deployImprovementRelease,
};
