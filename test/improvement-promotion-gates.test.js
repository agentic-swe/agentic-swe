'use strict';

/**
 * AE-035b — named acceptance tests:
 * 1. regression scorecard → promote denied
 * 2. merge/deploy tool path denied without human auth
 * 3. two procedure captures without user: never set human_approved=true (AE-R04)
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const improvement = require('../scripts/lib/improvement/index.cjs');
const {
  promoteOrDemote,
  approveProcedure,
  loadStore,
} = require('../scripts/lib/descent/promotion.cjs');
const { buildFingerprint } = require('../scripts/lib/descent/fingerprint.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', 'skill-version-compare');
const BASELINE = path.join(FIXTURES, 'v1-scorecard.json');
const REGRESSION = path.join(FIXTURES, 'v2-regression-scorecard.json');
const IMPROVED = path.join(FIXTURES, 'v2-improve-scorecard.json');

describe('AE-035b AC1 regression scorecard → promote denied', () => {
  it('regression_scorecard_promotes_denied', () => {
    const review = improvement.buildApprovedImprovementReview({
      proposal_id: 'imp-regress-1',
      baseline_ref: 'sha:baseline',
      reviewer: 'user:reviewer@example',
    });
    const result = improvement.promoteSelfImprovement({
      proposal_id: 'imp-regress-1',
      baselineScorecardPath: BASELINE,
      currentScorecardPath: REGRESSION,
      independentReview: review,
    });
    assert.equal(result.ok, false);
    assert.equal(result.promoted, false);
    assert.equal(result.decision, 'deny');
    assert.equal(result.code, 'REGRESSION');
    assert.ok((result.regressions || []).length > 0);
  });

  it('promote_requires_independent_review', () => {
    const result = improvement.evaluatePromotionGates({
      baselineScorecardPath: IMPROVED,
      currentScorecardPath: IMPROVED,
      independentReview: null,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'REVIEW_REQUIRED');
  });

  it('parity_scorecard_with_review_is_draft_eligible_not_merged', () => {
    const review = improvement.buildApprovedImprovementReview({
      proposal_id: 'imp-ok-1',
      reviewer: 'user:reviewer@example',
    });
    const result = improvement.promoteSelfImprovement({
      baselineScorecardPath: BASELINE,
      currentScorecardPath: IMPROVED,
      independentReview: review,
      skillCompare: {
        baselinePath: BASELINE,
        currentPath: IMPROVED,
        skill: 'demo',
        fromVersion: '1.0.0',
        toVersion: '1.0.1',
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.promoted, false);
    assert.equal(result.draft_pr_only, true);
    assert.equal(result.merge_authorized, false);
    assert.equal(result.decision, 'allow_draft_only');
    assert.ok(result.compare_digest);
  });
});

describe('AE-035b AC2 merge/deploy tool path denied without human auth', () => {
  it('merge_deploy_tool_path_denied_without_human_auth', () => {
    for (const toolName of ['github.merge', 'mergePullRequest', 'deploy', 'npm.publish']) {
      const denied = improvement.assertMergeDeployAllowed({
        toolName,
        actor: 'agent:builder',
        humanAuthorized: false,
      });
      assert.equal(denied.ok, false, toolName);
      assert.equal(denied.code, 'HUMAN_AUTH_REQUIRED');
      assert.equal(denied.decision, 'deny');
    }

    const noActor = improvement.assertMergeDeployAllowed({
      toolName: 'github.merge',
      humanAuthorized: true,
    });
    assert.equal(noActor.ok, false);
    assert.equal(noActor.code, 'HUMAN_AUTH_REQUIRED');

    const allowed = improvement.assertMergeDeployAllowed({
      toolName: 'github.merge',
      actor: 'user:founder@example',
      humanAuthorized: true,
      merge_authorized: true,
    });
    assert.equal(allowed.ok, true);
  });

  it('openImprovementDraftPr_forces_draft_and_refuses_ready', async () => {
    const calls = [];
    const createPull = async (repo, body) => {
      calls.push({ repo, body });
      return { ok: true, data: { html_url: 'https://example.test/pr/1', draft: body.draft } };
    };

    const ready = await improvement.openImprovementDraftPr({
      createPull,
      repo: 'acme/widgets',
      title: 'AE-035b',
      head: 'feat/imp',
      draft: false,
    });
    assert.equal(ready.ok, false);
    assert.equal(ready.code, 'DRAFT_REQUIRED');
    assert.equal(calls.length, 0);

    const opened = await improvement.openImprovementDraftPr({
      createPull,
      repo: 'acme/widgets',
      title: 'AE-035b',
      head: 'feat/imp',
      body: 'Refs ADR-011',
    });
    assert.equal(opened.ok, true);
    assert.equal(opened.draft, true);
    assert.equal(opened.merge_authorized, false);
    assert.equal(calls[0].body.draft, true);

    const merge = improvement.mergeImprovementPullRequest({ pr: 1 });
    assert.equal(merge.ok, false);
    assert.equal(merge.code, 'SELF_MERGE_DENIED');

    const deploy = improvement.deployImprovementRelease({ actor: 'agent:x' });
    assert.equal(deploy.ok, false);
    assert.equal(deploy.code, 'HUMAN_AUTH_REQUIRED');
  });

  it('forbidden_entry_points_still_absent_from_exports', () => {
    for (const name of improvement.FORBIDDEN_ENTRY_POINTS) {
      assert.equal(typeof improvement[name], 'undefined', name);
    }
  });
});

describe('AE-035b AC3 AE-R04 two captures never set human_approved', () => {
  it('two_procedure_captures_without_user_never_set_human_approved', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae035b-r04-'));
    try {
      const fp = buildFingerprint({ files: ['w1'], verifyCommand: 'npm test' });
      promoteOrDemote({
        projectRoot: tmp,
        fingerprint: fp,
        procedure: { verify: ['npm test'] },
        evalPassed: true,
        successCapture: true,
      });
      const r2 = promoteOrDemote({
        projectRoot: tmp,
        fingerprint: fp,
        procedure: { verify: ['npm test'] },
        evalPassed: true,
        successCapture: true,
      });
      assert.equal(r2.record.tier, 'L0');
      assert.equal(r2.record.success_count, 2);
      assert.equal(r2.record.auto_confirmed, true);
      assert.notEqual(r2.record.human_approved, true);
      assert.equal(r2.record.human_approved, false);

      const stored = loadStore(tmp).procedures.find((p) => p.fingerprint === fp);
      assert.equal(stored.human_approved, false);

      // Without a user: actor, approveProcedure must refuse and leave the flag false.
      const refused = approveProcedure({
        projectRoot: tmp,
        fingerprint: fp,
        actor: 'agent:builder',
      });
      assert.equal(refused.ok, false);
      assert.equal(refused.code, 'ACTOR_REQUIRED');
      assert.equal(loadStore(tmp).procedures[0].human_approved, false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
