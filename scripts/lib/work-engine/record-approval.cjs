'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadWorkItem, applyTransition } = require('./engine.cjs');
const { withWriteLockSync } = require('../shared/state-lock.cjs');
const { commitState } = require('../shared/journal.cjs');
const { DECISION_TARGET, RECORD_FILE, RISK_FILE } = require('../approval/human-approval.cjs');

function appendAudit(workDir, line) {
  fs.appendFileSync(path.join(workDir, 'audit.log'), `${line}\n`, 'utf8');
}

/**
 * Write the approval record and move the work item out of approval-wait.
 * Callers are responsible for having verified a human context (detectAgentContext).
 */
function recordApproval({ workDir, pluginRoot, decision, note, identity, risk, mode, soloFounder }) {
  if (!DECISION_TARGET[decision]) {
    return { ok: false, code: 'BAD_DECISION', message: `decision must be one of: ${Object.keys(DECISION_TARGET).join(', ')}` };
  }
  if (!identity || !identity.actor) return { ok: false, code: 'NO_IDENTITY', message: 'cannot resolve user identity (git user.email or OS user)' };
  const loaded = loadWorkItem(workDir, pluginRoot);
  if (!loaded.ok) return loaded;
  const state = loaded.state;
  if (state.current_state !== 'approval-wait') {
    return { ok: false, code: 'NOT_AT_APPROVAL_WAIT', message: `work item is at ${state.current_state}, not approval-wait` };
  }
  const iter = (state.counters && state.counters.approval_iter) || 0;
  const at = new Date().toISOString();
  const riskSummary = risk && risk.ok !== false
    ? { level: risk.level, counts: risk.counts, base: risk.base || null, head: risk.head || null }
    : { level: 'unknown', error: risk && risk.message ? risk.message : 'risk flags not computed' };

  fs.writeFileSync(path.join(workDir, RISK_FILE), JSON.stringify({ generated_at: at, ...risk }, null, 2) + '\n');
  const record = {
    work_id: state.work_id,
    decision,
    at,
    actor: identity.actor,
    identity: { name: identity.name || '', email: identity.email || '', os_user: identity.os_user || '' },
    approval_iter: iter,
    note: note || '',
    risk: riskSummary,
  };
  if (mode === 'solo_founder') {
    record.mode = 'solo_founder';
    record.head_sha = (soloFounder && soloFounder.head_sha) || null;
    record.github_login = (soloFounder && soloFounder.login) || null;
    record.codeowners = soloFounder
      ? {
          path: soloFounder.codeowners_path || null,
          ...(soloFounder.evidence || {}),
        }
      : null;
  }
  fs.writeFileSync(path.join(workDir, RECORD_FILE), JSON.stringify(record, null, 2) + '\n');

  if (decision === 'changes_requested') {
    const fb = [
      `# Approval feedback — round ${iter + 1}`,
      '',
      `- Decision: changes_requested`,
      `- By: ${identity.actor}`,
      `- At: ${at}`,
      `- Risk level at review: ${riskSummary.level}`,
      '',
      note || '(no note given)',
      '',
    ].join('\n');
    fs.appendFileSync(path.join(workDir, 'approval-feedback.md'), fb);
  }

  const to = DECISION_TARGET[decision];
  const r = applyTransition({
    workDir,
    pluginRoot,
    to,
    actor: identity.actor,
    reason: `human ${decision}${note ? `: ${note}` : ''}`,
    evidence_refs: [RECORD_FILE, RISK_FILE],
    humanApproval: { record: RECORD_FILE },
    decrementIterationBudget: false,
    skipMuscleMemory: true,
  });
  if (!r.ok) return r;

  const statePath = path.join(workDir, 'state.json');
  withWriteLockSync(workDir, () => {
    const next = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    next.approvals = next.approvals || {};
    next.counters = next.counters || {};
    if (decision === 'approved') {
      next.approvals.pr_approved = true;
      next.approvals.changes_requested = false;
    } else {
      next.approvals.changes_requested = true;
      next.counters.approval_iter = iter + 1;
    }
    next.approvals.last_decision = { decision, actor: identity.actor, at, record: RECORD_FILE };
    const snapshot = commitState(workDir, next, { type: 'approve', at, expectCurrent: next.current_state });
    fs.writeFileSync(statePath, JSON.stringify(snapshot, null, 2) + '\n');
  });

  appendAudit(
    workDir,
    `${at} actor=${identity.actor} action=approval decision=${decision} risk=${riskSummary.level} to=${to} | evidence: ${RECORD_FILE}, ${RISK_FILE}`
  );
  return { ok: true, decision, current_state: to, record };
}

module.exports = { recordApproval };
