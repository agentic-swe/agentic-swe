'use strict';

/**
 * AE-033a: semver candidate golden-eval compare + regression gate (PD-45).
 * ANY regression blocks publish. Improvement attaches compare_digest.
 * Layer: skills (service).
 */

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { compareScorecards } = require('../../bench/compare.cjs');

/**
 * Stable digest of a successful compare (baseline → current improvement / parity).
 * @param {object} payload
 */
function compareDigest(payload) {
  const canonical = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Compare two scorecard files for a skill version candidate.
 * @param {{
 *   baselinePath: string,
 *   currentPath: string,
 *   skill?: string,
 *   fromVersion?: string,
 *   toVersion?: string,
 *   minPassRate?: number|null
 * }} opts
 * @returns {{
 *   ok: boolean,
 *   code?: string,
 *   regressions?: object[],
 *   compare_digest?: string,
 *   exitCode: number,
 *   skill?: string,
 *   fromVersion?: string,
 *   toVersion?: string
 * }}
 */
function compareSkillVersions(opts) {
  const baselinePath = path.resolve(opts.baselinePath);
  const currentPath = path.resolve(opts.currentPath);
  if (!fs.existsSync(baselinePath) || !fs.existsSync(currentPath)) {
    return {
      ok: false,
      code: 'SCORECARD_MISSING',
      exitCode: 2,
      errors: ['baseline or current scorecard missing'],
    };
  }

  const result = compareScorecards(baselinePath, currentPath, {
    minPassRate: opts.minPassRate,
  });

  if (!result.ok) {
    return {
      ok: false,
      code: 'REGRESSION',
      exitCode: 1,
      regressions: result.regressions,
      skill: opts.skill,
      fromVersion: opts.fromVersion,
      toVersion: opts.toVersion,
    };
  }

  const digestPayload = {
    skill: opts.skill || null,
    fromVersion: opts.fromVersion || null,
    toVersion: opts.toVersion || null,
    baseline_pass_rate: result.baseline?.summary?.pass_rate ?? null,
    current_pass_rate: result.current?.summary?.pass_rate ?? null,
    baseline_tasks: (result.baseline?.tasks || []).map((t) => ({
      id: t.id,
      delivered: t.delivered === true,
      total: t.scores?.total ?? null,
    })),
    current_tasks: (result.current?.tasks || []).map((t) => ({
      id: t.id,
      delivered: t.delivered === true,
      total: t.scores?.total ?? null,
    })),
  };
  const digest = compareDigest(digestPayload);

  return {
    ok: true,
    exitCode: 0,
    compare_digest: digest,
    skill: opts.skill,
    fromVersion: opts.fromVersion,
    toVersion: opts.toVersion,
    baseline: result.baseline,
    current: result.current,
  };
}

/**
 * Publish gate: when compare scorecards are supplied, ANY regression fails closed.
 * @param {object} opts publishSkill opts
 */
function assertPublishCompareGate(opts) {
  const baseline = opts.compareBaseline || opts.baselineScorecard;
  const current = opts.compareCurrent || opts.candidateScorecard;
  if (!baseline && !current) {
    return { ok: true };
  }
  if (!baseline || !current) {
    return {
      ok: false,
      code: 'COMPARE_INCOMPLETE',
      errors: ['both compareBaseline and compareCurrent scorecards are required when either is set'],
    };
  }
  return compareSkillVersions({
    baselinePath: baseline,
    currentPath: current,
    skill: opts.compareSkill,
    fromVersion: opts.compareFromVersion,
    toVersion: opts.compareToVersion,
    minPassRate: opts.compareMinPassRate,
  });
}

module.exports = {
  compareDigest,
  compareSkillVersions,
  assertPublishCompareGate,
};
