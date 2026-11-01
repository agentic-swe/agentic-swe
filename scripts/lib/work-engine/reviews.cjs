'use strict';

/**
 * Independent review records (state.reviews, journaled as review.recorded / review.failed)
 * and the gate that keeps code-review from passing on missing, failed or blocking reviews.
 */

const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'];
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const VERDICTS = ['approved', 'rejected', 'escalated'];
const IMPLEMENTER_ROLES = new Set(['developer', 'developer-agent']);

/** Same key as policy mandatory_subagents: basename without .md, lowercased, plugin prefix removed. */
function reviewerKey(name) {
  return String(name || '')
    .replace(/^[^:/]+:/, '')
    .split('/')
    .pop()
    .replace(/\.md$/i, '')
    .trim()
    .toLowerCase();
}

/**
 * @param {unknown} findings
 * @returns {string[]} problems
 */
function validateFindings(findings) {
  if (!Array.isArray(findings)) return ['findings must be a JSON array'];
  const problems = [];
  const ids = new Set();
  findings.forEach((f, i) => {
    const at = `findings[${i}]`;
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      problems.push(`${at} must be an object`);
      return;
    }
    if (typeof f.id !== 'string' || !f.id.trim()) problems.push(`${at}.id must be a non-empty string`);
    else if (ids.has(f.id)) problems.push(`${at}.id "${f.id}" is duplicated`);
    else ids.add(f.id);
    if (!SEVERITIES.includes(f.severity)) problems.push(`${at}.severity must be one of ${SEVERITIES.join(', ')}`);
    if (typeof f.summary !== 'string' || !f.summary.trim()) problems.push(`${at}.summary must be a non-empty string`);
    if (!Array.isArray(f.evidence_refs) || !f.evidence_refs.length || f.evidence_refs.some((r) => typeof r !== 'string' || !r.trim())) {
      problems.push(`${at}.evidence_refs must be a non-empty array of strings`);
    }
    if (f.resolved !== undefined && typeof f.resolved !== 'boolean') problems.push(`${at}.resolved must be a boolean`);
  });
  return problems;
}

/** Model of the most recent developer spawn recorded with --model, else null. */
function implementerModel(state) {
  const history = Array.isArray(state.history) ? state.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e && e.kind === 'spawn' && IMPLEMENTER_ROLES.has(reviewerKey(e.role)) && typeof e.model === 'string' && e.model) {
      return e.model;
    }
  }
  return null;
}

function independenceOf(model, implementer) {
  if (!model || !implementer) return 'unknown';
  return model.trim().toLowerCase() === implementer.trim().toLowerCase() ? 'same_model' : 'independent';
}

/**
 * Pure: next state with one review appended.
 * @param {object} state
 * @param {object} input
 * @param {string} input.reviewer
 * @param {string} input.model
 * @param {string} input.runId
 * @param {boolean} [input.failed]
 * @param {string} [input.error] required when failed
 * @param {string} [input.verdict] required unless failed
 * @param {object[]} [input.findings]
 * @param {string} [input.implementerModel] overrides the developer spawn's model
 * @param {string} [input.actor]
 * @param {string} input.now
 * @returns {{ ok: true, next: object, review: object } | { ok: false, code: string, message: string }}
 */
function decideReview(state, input) {
  const bad = (code, message) => ({ ok: false, code, message });
  for (const k of ['reviewer', 'model', 'runId']) {
    if (typeof input[k] !== 'string' || !input[k].trim()) {
      return bad('REVIEW_INVALID', `record-review requires --${k === 'runId' ? 'run-id' : k}`);
    }
  }
  const reviews = Array.isArray(state.reviews) ? state.reviews : [];
  if (reviews.some((r) => r && r.run_id === input.runId)) {
    return bad('REVIEW_DUPLICATE_RUN', `run id ${input.runId} is already recorded`);
  }
  const findings = input.findings == null ? [] : input.findings;
  if (input.failed) {
    if (typeof input.error !== 'string' || !input.error.trim()) return bad('REVIEW_INVALID', 'a failed review requires --error');
    if (input.verdict) return bad('REVIEW_INVALID', 'a failed review has no verdict');
  } else {
    if (!VERDICTS.includes(input.verdict)) return bad('REVIEW_INVALID', `--verdict must be one of ${VERDICTS.join(', ')}`);
    const problems = validateFindings(findings);
    if (problems.length) return bad('REVIEW_INVALID', problems.join('; '));
  }

  const implementer = input.implementerModel || implementerModel(state);
  const review = {
    type: input.failed ? 'review.failed' : 'review.recorded',
    at: input.now,
    actor: input.actor || 'unknown',
    phase: state.current_state,
    history_index: Array.isArray(state.history) ? state.history.length : 0,
    reviewer: input.reviewer.trim(),
    model: input.model.trim(),
    run_id: input.runId.trim(),
    implementer_model: implementer || null,
    independence: independenceOf(input.model, implementer),
  };
  if (input.failed) {
    review.error = input.error.trim();
  } else {
    review.verdict = input.verdict;
    review.findings = findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      summary: f.summary,
      evidence_refs: f.evidence_refs,
      resolved: f.resolved === true,
    }));
  }
  const next = structuredClone(state);
  next.updated_at = input.now;
  next.reviews = [...reviews, review];
  return { ok: true, next, review };
}

/** Index of the history entry that entered `phase` most recently, or -1. */
function lastEntryIndex(state, phase) {
  const history = Array.isArray(state.history) ? state.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if (e && typeof e === 'object' && e.kind !== 'spawn' && e.to === phase && e.from !== phase) return i;
  }
  return -1;
}

/**
 * Reviews and reviewer spawns from the current visit to `phase`, and the latest review per reviewer.
 */
function currentRound(state, phase) {
  const start = lastEntryIndex(state, phase);
  const reviews = (Array.isArray(state.reviews) ? state.reviews : []).filter(
    (r) => r && r.phase === phase && r.history_index > start
  );
  const latest = new Map();
  for (const r of reviews) latest.set(reviewerKey(r.reviewer), r);
  const history = Array.isArray(state.history) ? state.history : [];
  const spawned = new Set();
  history.forEach((e, i) => {
    if (i > start && e && e.kind === 'spawn' && e.from === phase && !IMPLEMENTER_ROLES.has(reviewerKey(e.role))) {
      spawned.add(reviewerKey(e.role));
    }
  });
  return { reviews, latest, spawned };
}

function blockingFindings(review) {
  return (review.findings || []).filter((f) => BLOCKING_SEVERITIES.has(f.severity) && !f.resolved);
}

/**
 * code-review → permissions-check needs, for the current code-review round: at least one
 * recorded review, a result for every reviewer spawned in the round, no failed latest run,
 * no rejecting latest verdict, and no unresolved high/critical finding.
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
function assertReviewGate({ state, from, to }) {
  if (!(from === 'code-review' && to === 'permissions-check')) return { ok: true };
  const { latest, spawned } = currentRound(state, from);
  const how = 'record each reviewer result with `work record-review` (use --failed when a run errors or times out)';
  if (latest.size === 0) {
    return { ok: false, code: 'REVIEW_MISSING', message: `code-review → permissions-check needs at least one recorded review in this round; ${how}` };
  }
  const missing = [...spawned].filter((k) => !latest.has(k));
  if (missing.length) {
    return { ok: false, code: 'REVIEW_MISSING', message: `reviewer run(s) spawned with no result: ${missing.join(', ')}; ${how}` };
  }
  const failed = [...latest.values()].filter((r) => r.type === 'review.failed');
  if (failed.length) {
    return {
      ok: false,
      code: 'REVIEW_FAILED',
      message: `review run failed and is not a pass: ${failed.map((r) => `${r.reviewer} (${r.run_id}): ${r.error}`).join('; ')}`,
    };
  }
  const rejected = [...latest.values()].filter((r) => r.verdict !== 'approved');
  if (rejected.length) {
    return {
      ok: false,
      code: 'REVIEW_REJECTED',
      message: `latest review is not approved: ${rejected.map((r) => `${r.reviewer} (${r.run_id}) ${r.verdict}`).join('; ')}`,
    };
  }
  const blocking = [...latest.values()].flatMap((r) => blockingFindings(r).map((f) => `${r.reviewer}/${f.id} [${f.severity}] ${f.summary}`));
  if (blocking.length) {
    return {
      ok: false,
      code: 'REVIEW_BLOCKING_FINDINGS',
      message: `unresolved high/critical findings: ${blocking.join('; ')}. A new review run from the same reviewer must mark them resolved.`,
    };
  }
  return { ok: true };
}

/**
 * For status surfaces: counts, unresolved blocking findings, and same-model reviews.
 */
function reviewSummary(state) {
  const reviews = Array.isArray(state.reviews) ? state.reviews : [];
  const latest = new Map();
  for (const r of reviews) if (r) latest.set(`${r.phase}:${reviewerKey(r.reviewer)}`, r);
  const unresolved = [...latest.values()].flatMap((r) =>
    blockingFindings(r).map((f) => ({ reviewer: r.reviewer, run_id: r.run_id, phase: r.phase, id: f.id, severity: f.severity, summary: f.summary }))
  );
  return {
    recorded: reviews.filter((r) => r && r.type === 'review.recorded').length,
    failed: reviews.filter((r) => r && r.type === 'review.failed').length,
    unresolved_blocking: unresolved,
    same_model: reviews.filter((r) => r && r.independence === 'same_model').map((r) => ({ reviewer: r.reviewer, run_id: r.run_id, model: r.model })),
  };
}

module.exports = {
  SEVERITIES,
  VERDICTS,
  reviewerKey,
  validateFindings,
  implementerModel,
  decideReview,
  currentRound,
  assertReviewGate,
  reviewSummary,
};
