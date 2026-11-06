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

module.exports = {
  AGENT_ENV_MARKERS,
  DECISION_TARGET,
  RECORD_FILE,
  RISK_FILE,
  detectAgentContext,
  resolveUserIdentity,
  assertHumanApprovalGate,
};
