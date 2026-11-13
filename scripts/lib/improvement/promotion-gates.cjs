'use strict';

/**
 * AE-035b — promotion gates for governed self-improvement (PD-45 / FD-B / §15).
 *
 * compare + skill gates block promote on ANY regression. Independent review is
 * required. Eligibility never merges or deploys (draft-PR path only).
 *
 * Layer: improvement (service). Refs ADR-011, ADR-013; PD-42, PD-45.
 */

const fs = require('node:fs');
const path = require('node:path');
const { compareScorecards } = require('../../bench/compare.cjs');
const {
  compareSkillVersions,
  assertPublishCompareGate,
} = require('../skills/skill-version-compare.cjs');

const REQUIRED_FD_B = Object.freeze({
  human_merge_required: true,
  auto_merge: false,
  draft_pr_only: true,
  bypass_actors_empty: true,
  ruleset_unchanged: true,
});

/**
 * Build an approved independent-review artifact for self-improvement promote.
 * @param {{
 *   proposal_id: string,
 *   baseline_ref?: string,
 *   compare_digest?: string|null,
 *   reviewer?: string,
 *   notes?: string
 * }} opts
 */
function buildApprovedImprovementReview(opts) {
  const proposal_id = String(opts.proposal_id || '').trim();
  if (!proposal_id) {
    const err = new Error('proposal_id is required');
    err.code = 'IMPROVEMENT_INVALID';
    throw err;
  }
  return {
    schema_version: '1',
    kind: 'improvement-promote-review',
    proposal_id,
    baseline_ref: opts.baseline_ref || null,
    compare_digest: opts.compare_digest || null,
    verdict: 'approved',
    reviewer: String(opts.reviewer || 'independent-reviewer').trim() || 'independent-reviewer',
    reviewed_at: new Date().toISOString(),
    fd_b: { ...REQUIRED_FD_B },
    notes: opts.notes || 'AE-035b independent review (fixture)',
  };
}

/**
 * Validate independent review object or path.
 * @param {object|string|null|undefined} reviewOrPath
 */
function assertIndependentReview(reviewOrPath) {
  if (reviewOrPath == null || reviewOrPath === '') {
    return {
      ok: false,
      code: 'REVIEW_REQUIRED',
      errors: ['independent review required before self-improvement promote'],
    };
  }

  let review = reviewOrPath;
  if (typeof reviewOrPath === 'string') {
    const abs = path.resolve(reviewOrPath.trim());
    if (!abs || !fs.existsSync(abs)) {
      return {
        ok: false,
        code: 'REVIEW_MISSING',
        errors: [`review artifact missing: ${abs || '(blank)'}`],
      };
    }
    try {
      review = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (err) {
      return {
        ok: false,
        code: 'REVIEW_INVALID',
        errors: [`review artifact unreadable: ${err.message}`],
      };
    }
  }

  if (!review || typeof review !== 'object' || Array.isArray(review)) {
    return { ok: false, code: 'REVIEW_INVALID', errors: ['review must be an object'] };
  }
  if (review.kind !== 'improvement-promote-review') {
    return {
      ok: false,
      code: 'REVIEW_INVALID',
      errors: [`expected kind improvement-promote-review, got ${review.kind}`],
    };
  }
  if (review.verdict !== 'approved') {
    return {
      ok: false,
      code: 'REVIEW_REJECTED',
      errors: [`review verdict is ${review.verdict}, not approved`],
    };
  }
  const reviewer = String(review.reviewer || '').trim();
  if (!reviewer || reviewer === 'agent' || reviewer.startsWith('agent:')) {
    return {
      ok: false,
      code: 'REVIEW_NOT_INDEPENDENT',
      errors: ['reviewer must be an independent non-agent identity'],
    };
  }
  const fd = review.fd_b || {};
  for (const [k, expected] of Object.entries(REQUIRED_FD_B)) {
    if (fd[k] !== expected) {
      return {
        ok: false,
        code: 'REVIEW_FD_B',
        errors: [`fd_b.${k} must be ${expected}`],
      };
    }
  }
  return { ok: true, review };
}

/**
 * Run compare + optional skill gates. ANY regression → promote denied.
 * @param {{
 *   baselineScorecardPath?: string,
 *   currentScorecardPath?: string,
 *   skillCompare?: {
 *     baselinePath: string,
 *     currentPath: string,
 *     skill?: string,
 *     fromVersion?: string,
 *     toVersion?: string,
 *     minPassRate?: number|null
 *   },
 *   publishCompareOpts?: object,
 *   independentReview?: object|string|null,
 *   proposal_id?: string
 * }} opts
 */
function evaluatePromotionGates(opts = {}) {
  const reviewGate = assertIndependentReview(opts.independentReview);
  if (!reviewGate.ok) {
    return {
      ok: false,
      promoted: false,
      code: reviewGate.code,
      errors: reviewGate.errors,
      regressions: [],
    };
  }

  const baseline = opts.baselineScorecardPath;
  const current = opts.currentScorecardPath;
  if (!baseline || !current) {
    return {
      ok: false,
      promoted: false,
      code: 'SCORECARD_REQUIRED',
      errors: ['baselineScorecardPath and currentScorecardPath are required'],
      regressions: [],
    };
  }
  if (!fs.existsSync(path.resolve(baseline)) || !fs.existsSync(path.resolve(current))) {
    return {
      ok: false,
      promoted: false,
      code: 'SCORECARD_MISSING',
      errors: ['baseline or current scorecard missing'],
      regressions: [],
    };
  }

  const compare = compareScorecards(baseline, current);
  if (!compare.ok) {
    return {
      ok: false,
      promoted: false,
      code: compare.code || 'REGRESSION',
      errors: (compare.regressions || []).map(
        (r) => `[${r.id}] ${r.kind}: ${r.message}`
      ),
      regressions: compare.regressions || [],
      review: reviewGate.review,
    };
  }

  let skillCompare = null;
  if (opts.skillCompare) {
    skillCompare = compareSkillVersions(opts.skillCompare);
    if (!skillCompare.ok) {
      return {
        ok: false,
        promoted: false,
        code: skillCompare.code || 'REGRESSION',
        errors: (skillCompare.regressions || skillCompare.errors || []).map((r) =>
          typeof r === 'string' ? r : `[${r.id}] ${r.kind}: ${r.message}`
        ),
        regressions: skillCompare.regressions || [],
        review: reviewGate.review,
      };
    }
  }

  if (opts.publishCompareOpts) {
    const publishGate = assertPublishCompareGate(opts.publishCompareOpts);
    if (!publishGate.ok) {
      return {
        ok: false,
        promoted: false,
        code: publishGate.code || 'REGRESSION',
        errors: publishGate.errors || (publishGate.regressions || []).map(
          (r) => `[${r.id}] ${r.kind}: ${r.message}`
        ),
        regressions: publishGate.regressions || [],
        review: reviewGate.review,
      };
    }
    if (!skillCompare && publishGate.compare_digest) {
      skillCompare = publishGate;
    }
  }

  return {
    ok: true,
    promoted: false,
    code: 'ELIGIBLE',
    status: 'eligible_for_human_merge',
    draft_pr_only: true,
    merge_authorized: false,
    deploy_authorized: false,
    compare_digest: compare.compare_digest || (skillCompare && skillCompare.compare_digest) || null,
    review: reviewGate.review,
    skillCompare,
  };
}

/**
 * Attempt a self-improvement "promote". Never self-merges; only returns
 * eligibility after gates pass.
 * @param {Parameters<typeof evaluatePromotionGates>[0]} opts
 */
function promoteSelfImprovement(opts) {
  const gate = evaluatePromotionGates(opts);
  if (!gate.ok) {
    return { ...gate, promoted: false, decision: 'deny' };
  }
  return {
    ...gate,
    promoted: false,
    decision: 'allow_draft_only',
    message:
      'gates passed; open a draft PR only — human merge required (FD-B); no self-merge',
  };
}

module.exports = {
  REQUIRED_FD_B,
  buildApprovedImprovementReview,
  assertIndependentReview,
  evaluatePromotionGates,
  promoteSelfImprovement,
};
