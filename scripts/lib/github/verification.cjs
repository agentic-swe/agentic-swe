'use strict';

/**
 * Work-item side of GitHub approval verification (AE-015). When pr-link.txt names a github.com
 * PR, `work approve --decision approved` runs ApprovalService.verify and journals the verdict as
 * a `github.verified` event; approval-wait → completed then requires that event to be approved,
 * for the same PR, in the current approval round, with no transition since.
 */

const fs = require('node:fs');
const path = require('node:path');
const { readJournal, commitState } = require('../work-engine/journal.cjs');
const { withWriteLockSync } = require('../work-engine/state-lock.cjs');

const PR_URL = /https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/pull\/(\d+)\b/;
const EVENT_TYPE = 'github.verified';

/** @returns {{ repo: string, pr: number, url: string } | null} */
function parsePrLink(workDir) {
  const file = path.join(workDir, 'pr-link.txt');
  if (!fs.existsSync(file)) return null;
  const m = fs.readFileSync(file, 'utf8').match(PR_URL);
  if (!m) return null;
  return { repo: `${m[1]}/${m[2]}`, pr: Number(m[3]), url: m[0] };
}

function latestVerification(workDir) {
  const chain = readJournal(workDir);
  if (!chain.ok) return { ok: false, message: `journal FAILED at seq ${chain.seq}` };
  for (let i = chain.events.length - 1; i >= 0; i--) {
    const ev = chain.events[i];
    if (ev.type === EVENT_TYPE) {
      return { ok: true, verification: ev.state && ev.state.approvals && ev.state.approvals.github_verification };
    }
  }
  return { ok: true, verification: null };
}

/**
 * Engine gate for approval-wait → completed. A pr-link.txt without a github.com PR URL keeps
 * only the local approval record.
 */
function assertGitHubVerification({ workDir, state }) {
  const link = parsePrLink(workDir);
  if (!link) return { ok: true, applies: false };
  const deny = (why) => ({
    ok: false,
    code: 'GITHUB_APPROVAL_REQUIRED',
    message: `approval-wait → completed for ${link.url} needs a GitHub-verified approval: ${why}. A human runs \`agentic-swe work approve --decision approved\`, which checks code-owner review on the head SHA and required checks.`,
  });
  const found = latestVerification(workDir);
  if (!found.ok) return deny(found.message);
  const v = found.verification;
  if (!v) return deny('no github.verified journal event');
  if (v.repo !== link.repo || v.pr !== link.pr) return deny(`verification is for ${v.repo}#${v.pr}`);
  if (v.verdict !== 'approved') return deny(`latest verdict is ${v.verdict}: ${(v.reasons || []).map((r) => r.code).join(', ')}`);
  const iter = (state && state.counters && state.counters.approval_iter) || 0;
  if (v.approval_iter !== iter) return deny(`verification is from approval round ${v.approval_iter}, current round is ${iter}`);
  const historyLength = Array.isArray(state && state.history) ? state.history.length : 0;
  if (v.history_length !== historyLength) return deny('the work item changed after verification');
  return { ok: true, applies: true, verification: v };
}

/**
 * Run ApprovalService.verify for the work item's PR and journal the verdict (approved or not).
 * @param {{ workDir: string, service: { verify: Function }, link: object, actor: string,
 *           headSha?: string, calls?: object[] }} opts
 */
async function verifyAndJournal({ workDir, service, link, actor, headSha, calls }) {
  const result = await service.verify({ repo: link.repo, pr: link.pr, head_sha: headSha });
  const at = new Date().toISOString();
  const statePath = path.join(workDir, 'state.json');
  const verification = withWriteLockSync(workDir, () => {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (state.current_state !== 'approval-wait') {
      const err = new Error(`work item is at ${state.current_state}, not approval-wait`);
      err.code = 'NOT_AT_APPROVAL_WAIT';
      throw err;
    }
    const v = {
      verdict: result.approved ? 'approved' : 'not_approved',
      repo: link.repo,
      pr: link.pr,
      head_sha: result.head_sha || headSha || null,
      pr_head: result.pr_head || null,
      approvers: result.approvers || [],
      required_checks: result.required_checks || [],
      reasons: result.reasons || [],
      approval_iter: (state.counters && state.counters.approval_iter) || 0,
      history_length: Array.isArray(state.history) ? state.history.length : 0,
      at,
      actor,
      calls: (calls || []).slice(),
    };
    state.approvals = state.approvals || {};
    state.approvals.github_verification = v;
    const snapshot = commitState(workDir, state, { type: EVENT_TYPE, at, expectCurrent: 'approval-wait' });
    fs.writeFileSync(statePath, `${JSON.stringify(snapshot, null, 2)}\n`);
    return v;
  });
  fs.appendFileSync(
    path.join(workDir, 'audit.log'),
    `${at} actor=${actor} action=github_verified verdict=${verification.verdict} pr=${link.repo}#${link.pr} head=${verification.head_sha || 'unknown'}${verification.reasons.length ? ` reasons=${verification.reasons.map((r) => r.code).join(',')}` : ''}\n`,
    'utf8'
  );
  return { ok: true, approved: verification.verdict === 'approved', verification };
}

module.exports = { EVENT_TYPE, parsePrLink, latestVerification, assertGitHubVerification, verifyAndJournal };
