'use strict';

/**
 * AE-032c: machine-checkable independent review artifact for publishSkill.
 * Templates / JSON only — no LLM. Layer: skills (service).
 *
 * FD-B checklist (must all be true / asserted):
 * - human_merge_required
 * - auto_merge === false (no auto-merge)
 * - pack_main_via_human_pr (first-party library → main only via human-merged PR)
 * - bypass_actors_empty
 * - ruleset_unchanged
 */

const fs = require('node:fs');
const path = require('node:path');

const REQUIRED_CHECKLIST = [
  'human_merge_required',
  'auto_merge',
  'pack_main_via_human_pr',
  'bypass_actors_empty',
  'ruleset_unchanged',
];

/**
 * @typedef {{
 *   schema_version: string,
 *   kind: 'skill-publish-review',
 *   skill: string,
 *   version: string,
 *   digest: string,
 *   verdict: 'approved' | 'rejected',
 *   reviewer: string,
 *   reviewed_at: string,
 *   fd_b: {
 *     human_merge_required: true,
 *     auto_merge: false,
 *     pack_main_via_human_pr: true,
 *     bypass_actors_empty: true,
 *     ruleset_unchanged: true
 *   },
 *   notes?: string
 * }} SkillPublishReview
 */

/**
 * Build a valid approved review fixture (for tests / offline tooling).
 * @param {{
 *   skill: string,
 *   version: string,
 *   digest: string,
 *   reviewer?: string,
 *   notes?: string
 * }} opts
 * @returns {SkillPublishReview}
 */
function buildApprovedPublishReview(opts) {
  const skill = String(opts.skill || '').trim();
  const version = String(opts.version || '').trim();
  const digest = String(opts.digest || '').trim().toLowerCase();
  return {
    schema_version: '1',
    kind: 'skill-publish-review',
    skill,
    version,
    digest,
    verdict: 'approved',
    reviewer: String(opts.reviewer || 'independent-reviewer').trim() || 'independent-reviewer',
    reviewed_at: new Date().toISOString(),
    fd_b: {
      human_merge_required: true,
      auto_merge: false,
      pack_main_via_human_pr: true,
      bypass_actors_empty: true,
      ruleset_unchanged: true,
    },
    notes: opts.notes || 'AE-032c independent review (fixture)',
  };
}

/**
 * Load review JSON from object or filesystem path.
 * @param {object|string|null|undefined} reviewOrPath
 * @returns {{ ok: true, review: object } | { ok: false, code: string, errors: string[] }}
 */
function loadPublishReview(reviewOrPath) {
  if (reviewOrPath == null || reviewOrPath === '') {
    return { ok: false, code: 'REVIEW_REQUIRED', errors: ['review artifact required before publishSkill'] };
  }
  if (typeof reviewOrPath === 'object' && !Array.isArray(reviewOrPath)) {
    return { ok: true, review: reviewOrPath };
  }
  const p = String(reviewOrPath).trim();
  if (!p) {
    return { ok: false, code: 'REVIEW_REQUIRED', errors: ['review artifact path is blank'] };
  }
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) {
    return { ok: false, code: 'REVIEW_MISSING', errors: [`review artifact missing: ${abs}`] };
  }
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    return { ok: false, code: 'REVIEW_UNREADABLE', errors: [err.message] };
  }
  if (!String(text).trim()) {
    return { ok: false, code: 'REVIEW_BLANK', errors: ['review artifact is blank'] };
  }
  try {
    const review = JSON.parse(text);
    if (!review || typeof review !== 'object' || Array.isArray(review)) {
      return { ok: false, code: 'REVIEW_INVALID', errors: ['review artifact must be a JSON object'] };
    }
    return { ok: true, review };
  } catch (err) {
    return { ok: false, code: 'REVIEW_PARSE', errors: [err.message] };
  }
}

/**
 * Validate FD-B checklist + machine-checkable fields.
 * @param {object} review
 * @param {{ skill?: string, version?: string, digest?: string }} [expected]
 * @returns {{ ok: true, review: object } | { ok: false, code: string, errors: string[] }}
 */
function validatePublishReview(review, expected = {}) {
  const errors = [];
  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    return { ok: false, code: 'REVIEW_INVALID', errors: ['review must be an object'] };
  }
  if (String(review.kind || '') !== 'skill-publish-review') {
    errors.push('kind must be skill-publish-review');
  }
  if (String(review.schema_version || '') !== '1') {
    errors.push('schema_version must be "1"');
  }
  const skill = String(review.skill || '').trim();
  const version = String(review.version || '').trim();
  const digest = String(review.digest || '').trim().toLowerCase();
  const reviewer = String(review.reviewer || '').trim();
  const verdict = String(review.verdict || '').trim().toLowerCase();
  if (!skill) errors.push('skill required');
  if (!version) errors.push('version required');
  if (!/^[a-f0-9]{64}$/.test(digest)) errors.push('digest must be sha256 hex');
  if (!reviewer) errors.push('reviewer required');
  if (!review.reviewed_at || !String(review.reviewed_at).trim()) errors.push('reviewed_at required');
  if (verdict !== 'approved') {
    return {
      ok: false,
      code: verdict === 'rejected' ? 'REVIEW_REJECTED' : 'REVIEW_VERDICT_INVALID',
      errors: [`verdict must be approved (got ${JSON.stringify(review.verdict)})`],
    };
  }

  const fd = review.fd_b;
  if (!fd || typeof fd !== 'object' || Array.isArray(fd)) {
    errors.push('fd_b checklist object required');
  } else {
    for (const key of REQUIRED_CHECKLIST) {
      if (!Object.prototype.hasOwnProperty.call(fd, key)) {
        errors.push(`fd_b.${key} required`);
        continue;
      }
      if (key === 'auto_merge') {
        if (fd.auto_merge !== false) {
          errors.push('fd_b.auto_merge must be false (no auto-merge / FD-B)');
        }
      } else if (fd[key] !== true) {
        errors.push(`fd_b.${key} must be true`);
      }
    }
  }

  if (expected.skill && skill !== String(expected.skill).trim()) {
    errors.push(`review.skill ${skill} does not match package ${expected.skill}`);
  }
  if (expected.version && version !== String(expected.version).trim()) {
    errors.push(`review.version ${version} does not match package ${expected.version}`);
  }
  if (expected.digest) {
    const want = String(expected.digest).trim().toLowerCase();
    if (digest !== want) {
      errors.push(`review.digest does not match package digest`);
    }
  }

  if (errors.length) {
    return { ok: false, code: 'REVIEW_INVALID', errors };
  }
  return { ok: true, review };
}

/**
 * Resolve + validate a publish review for a package identity.
 * @param {{
 *   reviewArtifact?: object|string,
 *   reviewPath?: string,
 *   skill: string,
 *   version: string,
 *   digest: string
 * }} opts
 */
function requirePublishReview(opts) {
  const artifact = opts.reviewArtifact != null ? opts.reviewArtifact : opts.reviewPath;
  const loaded = loadPublishReview(artifact);
  if (!loaded.ok) return loaded;
  return validatePublishReview(loaded.review, {
    skill: opts.skill,
    version: opts.version,
    digest: opts.digest,
  });
}

module.exports = {
  REQUIRED_CHECKLIST,
  buildApprovedPublishReview,
  loadPublishReview,
  validatePublishReview,
  requirePublishReview,
};
