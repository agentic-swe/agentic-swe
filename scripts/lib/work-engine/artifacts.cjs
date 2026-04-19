'use strict';

const fs = require('node:fs');
const path = require('node:path');

function fileNonEmpty(absPath) {
  try {
    const st = fs.statSync(absPath);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
}

/**
 * Alternatives: each inner array is OR of filenames (one must exist and be non-empty).
 * @param {string} workDir
 * @param {string[][]} groups
 * @returns {{ ok: boolean, missing: string[] }}
 */
function checkAlternatives(workDir, groups) {
  const missing = [];
  for (const group of groups) {
    const ok = group.some((name) => fileNonEmpty(path.join(workDir, name)));
    if (!ok) missing.push(group.join('|'));
  }
  return { ok: missing.length === 0, missing };
}

/**
 * Required artifacts for state `to` when transitioning from `from`.
 * Matches CLAUDE.md "Required Artifacts by State" with bootstrap and conditional rows.
 *
 * @param {string} from
 * @param {string} to
 * @param {object} state
 * @returns {string[][]} OR-groups of filenames
 */
function requiredArtifactGroups(from, to, state) {
  // Bootstrap: entering feasibility from initialized does not yet have feasibility.md
  if (from === 'initialized' && to === 'feasibility') {
    return [];
  }

  switch (to) {
    case 'feasibility':
      return [['feasibility.md']];
    case 'ambiguity-wait':
      return [['feasibility.md'], ['ambiguity-report.md']];
    case 'lean-track-check':
      return [['lean-track-check.md']];
    case 'lean-track-implementation':
      return [['implementation.md'], ['review-pass.md', 'review-feedback.md']];
    case 'design': {
      const groups = [['design.md']];
      if (from === 'design-review') groups.push(['reflection-log.md']);
      return groups;
    }
    case 'design-review':
      return [['design-review.md', 'design-feedback.md']];
    case 'verification':
      return [['verification-results.md']];
    case 'test-strategy':
      return [['test-stubs.md'], ['test-results.md']];
    case 'implementation': {
      const groups = [['implementation.md']];
      if (from === 'self-review' || from === 'code-review' || from === 'validation') {
        groups.push(['reflection-log.md']);
      }
      return groups;
    }
    case 'self-review':
      return [['self-review.md']];
    case 'code-review':
      return [['review-pass.md', 'review-feedback.md']];
    case 'permissions-check':
      return [['permissions-changes.md']];
    case 'validation':
      return [['validation-results.md']];
    case 'pr-creation':
      return [['cicd.md'], ['pr-link.txt']];
    case 'approval-wait': {
      const groups = [['cicd.md'], ['pr-link.txt']];
      if (state.approvals && state.approvals.changes_requested) {
        groups.push(['approval-feedback.md']);
      }
      return groups;
    }
    case 'completed':
      return [['cicd.md'], ['pr-link.txt']];
    case 'escalate-code':
      return [['review-feedback.md', 'permissions-changes.md']];
    case 'escalate-validation':
      return [['validation-results.md']];
    case 'pipeline-failed':
      if (from === 'feasibility' || from === 'ambiguity-wait') return [['feasibility.md']];
      if (from === 'verification') return [['verification-results.md']];
      return [['feasibility.md', 'verification-results.md']];
    default:
      return [];
  }
}

/**
 * @param {string} workDir
 * @param {string} from
 * @param {string} to
 * @param {object} state
 */
function assertArtifactsForTransition(workDir, from, to, state) {
  const groups = requiredArtifactGroups(from, to, state);
  const r = checkAlternatives(workDir, groups);
  if (!r.ok) {
    return {
      ok: false,
      code: 'ARTIFACTS_INCOMPLETE',
      message: `missing or empty artifacts for ${to}: ${r.missing.join('; ')}`,
      missing: r.missing,
    };
  }
  return { ok: true };
}

module.exports = {
  requiredArtifactGroups,
  assertArtifactsForTransition,
  checkAlternatives,
  fileNonEmpty,
};
