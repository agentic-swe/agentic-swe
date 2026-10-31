'use strict';

/**
 * Human-only approval entry for approval-wait (OWASP ASI09).
 *
 * This is a procedural control: an agent with unrestricted shell and filesystem access
 * can still hand-edit state.json. It removes the easy path (the agent calling
 * `work transition --to completed`) and leaves an attributable record. Cryptographic
 * identity binding is out of scope (see ASI03).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RECORD_FILE = 'approval-record.json';
const RISK_FILE = 'approval-risk.json';

const AGENT_ENV_MARKERS = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CURSOR_AGENT',
  'CODEX_SANDBOX',
  'CODEX_SANDBOX_NETWORK_DISABLED',
  'GEMINI_CLI',
  'OPENCODE',
  'AGENTIC_SWE_AGENT',
];

const DECISION_TARGET = {
  approved: 'completed',
  changes_requested: 'implementation',
};

/**
 * @returns {string|null} refusal reason, or null when this looks like a human terminal
 */
function detectAgentContext({ env = process.env, isTTY = Boolean(process.stdin.isTTY) } = {}) {
  const hit = AGENT_ENV_MARKERS.find((k) => env[k] != null && env[k] !== '' && env[k] !== '0');
  if (hit) return `agent session detected (${hit} is set); approvals must be entered by a human in their own terminal`;
  if (!isTTY) return 'stdin is not a TTY; approvals must be entered interactively by a human';
  return null;
}

function gitConfig(cwd, key) {
  const r = spawnSync('git', ['config', '--get', key], { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function resolveUserIdentity({ cwd = process.cwd() } = {}) {
  let osUser = '';
  try {
    osUser = os.userInfo().username;
  } catch {
    osUser = process.env.USER || process.env.USERNAME || '';
  }
  const name = gitConfig(cwd, 'user.name');
  const email = gitConfig(cwd, 'user.email');
  const who = email || osUser;
  if (!who) return null;
  return { name, email, os_user: osUser, actor: `user:${who}` };
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Leaving approval-wait requires an approval record written by `work approve`.
 */
function assertHumanApprovalGate({ workDir, from, to, state, humanApproval }) {
  if (from !== 'approval-wait') return { ok: true };
  const deny = (why) => ({
    ok: false,
    code: 'HUMAN_APPROVAL_REQUIRED',
    message: `approval-wait → ${to} needs a human decision: ${why}. A human must run \`agentic-swe work approve --work-dir ${workDir} --decision approved|changes_requested\` in their own terminal.`,
  });
  if (!humanApproval || !humanApproval.record) return deny('no approval record supplied');
  const rec = readJson(path.join(workDir, path.basename(humanApproval.record)));
  if (!rec) return deny(`${humanApproval.record} missing or unreadable`);
  if (DECISION_TARGET[rec.decision] !== to) return deny(`record decision "${rec.decision}" does not lead to ${to}`);
  const iter = (state && state.counters && state.counters.approval_iter) || 0;
  if (rec.approval_iter !== iter) return deny(`record is from approval round ${rec.approval_iter}, current round is ${iter}`);
  if (typeof rec.actor !== 'string' || !rec.actor.startsWith('user:')) return deny('record actor is not a user identity');
  return { ok: true, record: rec };
}

function appendAudit(workDir, line) {
  fs.appendFileSync(path.join(workDir, 'audit.log'), `${line}\n`, 'utf8');
}

/**
 * Write the approval record and move the work item out of approval-wait.
 * Callers are responsible for having verified a human context (detectAgentContext).
 */
function recordApproval({ workDir, pluginRoot, decision, note, identity, risk }) {
  const { loadWorkItem, applyTransition } = require('../work-engine/engine.cjs');
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

  const { withWriteLockSync } = require('../work-engine/state-lock.cjs');
  const { commitState } = require('../work-engine/journal.cjs');
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

module.exports = {
  AGENT_ENV_MARKERS,
  DECISION_TARGET,
  RECORD_FILE,
  RISK_FILE,
  detectAgentContext,
  resolveUserIdentity,
  assertHumanApprovalGate,
  recordApproval,
};
