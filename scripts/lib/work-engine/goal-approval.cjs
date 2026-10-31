'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  GOAL_DECISION_TARGET,
  GOAL_RECORD_FILE,
  loadGoal,
  applyGoalTransition,
  commitGoal,
} = require('./goal.cjs');

const RISK_FILE = 'approval-risk.json';

/**
 * Write the approval record and leave goal-approval.
 * Callers verify a human context first.
 */
function recordGoalApproval({ goalDir, pluginRoot, decision, note, identity }) {
  if (!GOAL_DECISION_TARGET[decision]) {
    return {
      ok: false,
      code: 'BAD_DECISION',
      message: `decision must be one of: ${Object.keys(GOAL_DECISION_TARGET).join(', ')}`,
    };
  }
  if (!identity || typeof identity.actor !== 'string' || !identity.actor.startsWith('user:')) {
    return { ok: false, code: 'NO_IDENTITY', message: 'cannot resolve a user: identity (git user.email or OS user)' };
  }
  const loaded = loadGoal(goalDir);
  if (!loaded.ok) return loaded;
  const goal = loaded.goal;
  if (goal.current_state !== 'goal-approval') {
    return {
      ok: false,
      code: 'NOT_AT_GOAL_APPROVAL',
      message: `goal is at ${goal.current_state}, not goal-approval`,
    };
  }

  const iter = (goal.counters && goal.counters.approval_iter) || 0;
  const at = new Date().toISOString();
  const risk = { level: 'unknown', error: 'goal approval has no diff risk flags' };
  const record = {
    work_id: goal.goal_id,
    decision,
    at,
    actor: identity.actor,
    identity: {
      name: identity.name || '',
      email: identity.email || '',
      os_user: identity.os_user || '',
    },
    approval_iter: iter,
    note: note || '',
    risk,
  };
  fs.writeFileSync(path.join(goalDir, RISK_FILE), `${JSON.stringify({ generated_at: at, ...risk }, null, 2)}\n`);
  fs.writeFileSync(path.join(goalDir, GOAL_RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`);

  const to = GOAL_DECISION_TARGET[decision];
  const moved = applyGoalTransition({
    goalDir,
    pluginRoot,
    to,
    actor: identity.actor,
    reason: `human ${decision}${note ? `: ${note}` : ''}`,
    evidence_refs: [GOAL_RECORD_FILE, RISK_FILE],
    humanApproval: { record: GOAL_RECORD_FILE },
  });
  if (!moved.ok) return moved;

  const next = moved.goal;
  next.gates = next.gates || {};
  next.counters = next.counters || {};
  next.approvals = next.approvals || {};
  if (decision === 'approved') {
    next.gates.goal_approved = true;
  } else {
    next.counters.approval_iter = iter + 1;
  }
  next.approvals.last_decision = { decision, actor: identity.actor, at, record: GOAL_RECORD_FILE };
  next.updated_at = at;

  try {
    const snapshot = commitGoal(goalDir, next, { type: 'approve', at, expectCurrent: next.current_state });
    return { ok: true, decision, current_state: snapshot.current_state, record };
  } catch (e) {
    if (e && (e.code === 'LOCK_TIMEOUT' || e.code === 'INTEGRITY_FAILED')) {
      return { ok: false, code: e.code, message: String(e.message) };
    }
    return { ok: false, code: 'WRITE_ERROR', message: String(e.message) };
  }
}

module.exports = { recordGoalApproval, RISK_FILE };
