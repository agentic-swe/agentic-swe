'use strict';

/**
 * AE-035a/b — governed self-improvement work template, journal events,
 * promotion gates, draft-PR-only tooling, and merge/deploy deny without
 * human authority (M4.6 / FD-B / §15 / PD-45).
 *
 * Merge/deploy/self-merge entry points remain denied in this module surface.
 * Policy/PDP baseline is unchanged (tooling-layer enforcement).
 *
 * Refs ADR-011, ADR-013; PD-42, PD-45.
 */

const fs = require('node:fs');
const path = require('node:path');
const { appendEvent } = require('../shared/journal.cjs');
const { validateEvent } = require('../shared/journal-registry.cjs');
const promotionGates = require('./promotion-gates.cjs');
const draftPr = require('./draft-pr.cjs');

const PLUGIN_ROOT = path.join(__dirname, '..', '..', '..');
const STATE_TEMPLATE_PATH = path.join(PLUGIN_ROOT, 'templates', 'self-improvement-state.json');
const PROPOSAL_TEMPLATE_PATH = path.join(PLUGIN_ROOT, 'templates', 'improvement-proposal.md');

const MODE = 'self-improvement';
const EVENT_PROPOSED = 'improvement.proposed';
const EVENT_EVALUATED = 'improvement.evaluated';

/** Explicit denylist — tests assert these names are never exported. */
const FORBIDDEN_ENTRY_POINTS = Object.freeze([
  'merge',
  'mergePullRequest',
  'mergePR',
  'deploy',
  'publish',
  'npmPublish',
  'selfMerge',
  'bypassReview',
]);

/**
 * Load the self-improvement work-item state template (placeholders intact).
 * @returns {object}
 */
function loadSelfImprovementStateTemplate() {
  const raw = fs.readFileSync(STATE_TEMPLATE_PATH, 'utf8');
  return JSON.parse(raw);
}

/**
 * Build a concrete self-improvement work-item state from the template.
 * Does not write to disk; caller persists under `.worklogs/<id>/state.json`.
 *
 * @param {{
 *   work_id: string,
 *   task: string,
 *   owner?: string,
 *   created_at?: string,
 *   baseline_ref?: string,
 *   proposal_id?: string,
 * }} opts
 * @returns {object}
 */
function buildSelfImprovementWorkItem(opts) {
  if (!opts || typeof opts.work_id !== 'string' || !opts.work_id.trim()) {
    const err = new Error('work_id is required');
    err.code = 'IMPROVEMENT_INVALID';
    throw err;
  }
  if (typeof opts.task !== 'string' || !opts.task.trim()) {
    const err = new Error('task is required');
    err.code = 'IMPROVEMENT_INVALID';
    throw err;
  }
  const now = opts.created_at || new Date().toISOString();
  const state = loadSelfImprovementStateTemplate();
  state.work_id = opts.work_id.trim();
  state.task = opts.task.trim();
  state.owner = opts.owner || state.owner || 'agent';
  state.mode = MODE;
  state.created_at = now;
  state.updated_at = now;
  state.timeout_at = state.timeout_at === '<ISO-8601 timestamp>'
    ? new Date(Date.parse(now) + 7 * 24 * 60 * 60 * 1000).toISOString()
    : state.timeout_at;
  if (!state.pipeline || typeof state.pipeline !== 'object') state.pipeline = {};
  state.pipeline.track = 'rigorous';
  if (!state.improvement || typeof state.improvement !== 'object') state.improvement = {};
  state.improvement.proposal_id = opts.proposal_id || null;
  state.improvement.baseline_ref = opts.baseline_ref || null;
  state.improvement.status = 'draft';
  state.improvement.draft_pr_only = true;
  state.improvement.merge_authorized = false;
  state.improvement.deploy_authorized = false;
  state.improvement.independent_review_required = true;
  return state;
}

/**
 * Return the markdown proposal artifact template path / contents.
 * @returns {{ path: string, body: string }}
 */
function loadImprovementProposalTemplate() {
  return {
    path: PROPOSAL_TEMPLATE_PATH,
    body: fs.readFileSync(PROPOSAL_TEMPLATE_PATH, 'utf8'),
  };
}

/**
 * Validate then append `improvement.proposed` to the work journal.
 * @param {string} workDir
 * @param {object} payload
 * @param {{ idempotency_key?: string, at?: string }} [opts]
 */
function proposeImprovement(workDir, payload, opts = {}) {
  const check = validateEvent(EVENT_PROPOSED, payload);
  if (!check.ok) {
    const err = new Error(check.message);
    err.code = check.code || 'EVENT_INVALID';
    throw err;
  }
  return appendEvent(workDir, {
    type: EVENT_PROPOSED,
    payload,
    idempotency_key: opts.idempotency_key || `improvement.proposed:${payload.proposal_id}`,
    at: opts.at,
  });
}

/**
 * Validate then append `improvement.evaluated` to the work journal.
 * @param {string} workDir
 * @param {object} payload
 * @param {{ idempotency_key?: string, at?: string }} [opts]
 */
function evaluateImprovement(workDir, payload, opts = {}) {
  const check = validateEvent(EVENT_EVALUATED, payload);
  if (!check.ok) {
    const err = new Error(check.message);
    err.code = check.code || 'EVENT_INVALID';
    throw err;
  }
  return appendEvent(workDir, {
    type: EVENT_EVALUATED,
    payload,
    idempotency_key:
      opts.idempotency_key ||
      `improvement.evaluated:${payload.proposal_id}:${payload.outcome}`,
    at: opts.at,
  });
}

/**
 * Public surface for AE-035a/b. Intentionally excludes merge/deploy success paths.
 */
module.exports = {
  MODE,
  EVENT_PROPOSED,
  EVENT_EVALUATED,
  FORBIDDEN_ENTRY_POINTS,
  STATE_TEMPLATE_PATH,
  PROPOSAL_TEMPLATE_PATH,
  loadSelfImprovementStateTemplate,
  buildSelfImprovementWorkItem,
  loadImprovementProposalTemplate,
  proposeImprovement,
  evaluateImprovement,
  // AE-035b promotion gates + draft PR / authority
  REQUIRED_FD_B: promotionGates.REQUIRED_FD_B,
  buildApprovedImprovementReview: promotionGates.buildApprovedImprovementReview,
  assertIndependentReview: promotionGates.assertIndependentReview,
  evaluatePromotionGates: promotionGates.evaluatePromotionGates,
  promoteSelfImprovement: promotionGates.promoteSelfImprovement,
  MERGE_DEPLOY_TOOL_PATHS: draftPr.MERGE_DEPLOY_TOOL_PATHS,
  isMergeOrDeployToolPath: draftPr.isMergeOrDeployToolPath,
  assertMergeDeployAllowed: draftPr.assertMergeDeployAllowed,
  openImprovementDraftPr: draftPr.openImprovementDraftPr,
  mergeImprovementPullRequest: draftPr.mergeImprovementPullRequest,
  deployImprovementRelease: draftPr.deployImprovementRelease,
};
