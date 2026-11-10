'use strict';

/**
 * ApprovalService (AE-015 / PD-13). A PR is approved only when, for every changed file that has
 * code owners, an owner's latest review is APPROVED on the head SHA (dismissed and stale reviews
 * do not count), no owner's latest review requests changes, and the required checks are green.
 * Any API failure is a not-approved verdict.
 *
 * Solo-founder mode (opt-in, off by default): when approval.solo_founder is enabled, the PR author
 * is the configured founder login, that login is the sole CODEOWNER for every changed path, the
 * receipted head_sha matches the live PR head, required checks are green, and the caller asserts
 * a human TTY context (`human_ok`), the PR may be approved without a GitHub review (GitHub blocks
 * self-approval). Agents never get human_ok; write flag stays off.
 */

const { parseCodeowners, ownersFor } = require('./codeowners.cjs');

const PASSING = new Set(['success', 'neutral', 'skipped']);
const IGNORED_REVIEW_STATES = new Set(['COMMENTED', 'PENDING']);

function reason(code, detail) {
  return { code, detail };
}

function latestReviewPerUser(reviews) {
  const byUser = new Map();
  const ordered = reviews.slice().sort((a, b) => {
    const ta = Date.parse(a.submitted_at || 0) || 0;
    const tb = Date.parse(b.submitted_at || 0) || 0;
    return ta - tb || (a.id || 0) - (b.id || 0);
  });
  for (const r of ordered) {
    if (!r.user || !r.user.login || IGNORED_REVIEW_STATES.has(r.state)) continue;
    byUser.set(r.user.login.toLowerCase(), r);
  }
  return byUser;
}

function requiredContexts(rules) {
  const out = new Set();
  for (const rule of rules || []) {
    if (rule && rule.type === 'required_status_checks') {
      for (const c of (rule.parameters && rule.parameters.required_status_checks) || []) {
        if (c && c.context) out.add(c.context);
      }
    }
  }
  return [...out];
}

function latestRunByName(runs) {
  const byName = new Map();
  for (const run of runs || []) {
    const prev = byName.get(run.name);
    if (!prev || (run.id || 0) > (prev.id || 0)) byName.set(run.name, run);
  }
  return byName;
}

function evaluateCheck(context, runsByName, statuses) {
  const run = runsByName.get(context);
  if (run) {
    if (run.status !== 'completed') return { context, state: 'pending' };
    return { context, state: PASSING.has(run.conclusion) ? 'pass' : 'fail', conclusion: run.conclusion };
  }
  const st = (statuses || []).find((s) => s.context === context);
  if (st) return { context, state: st.state === 'success' ? 'pass' : st.state === 'pending' ? 'pending' : 'fail', conclusion: st.state };
  return { context, state: 'missing' };
}

function soloConfig(config) {
  const solo = config && config.approval && config.approval.solo_founder;
  if (!solo || solo.enabled !== true || !solo.github_login) {
    return { enabled: false, github_login: '' };
  }
  return { enabled: true, github_login: String(solo.github_login) };
}

/**
 * Every changed path must be owned by exactly one individual login matching founderLogin.
 * Team owners (@org/team) or any second distinct owner make solo mode ineligible.
 */
function soleFounderOwnership(rules, files, founderLogin) {
  if (!rules) return { ok: false, code: 'NO_CODEOWNERS', detail: 'no CODEOWNERS rules loaded' };
  const want = founderLogin.toLowerCase();
  const wantAt = `@${want}`;
  const ownerSets = [];
  const changed_paths = [];
  const unique = new Set();

  for (const f of files || []) {
    const filename = f.filename || f;
    const owners = ownersFor(rules, filename);
    changed_paths.push(filename);
    if (!owners.length) {
      return { ok: false, code: 'UNOWNED_CHANGES', detail: `${filename} has no code owner` };
    }
    ownerSets.push(owners.slice());
    for (const o of owners) {
      if (!o.startsWith('@')) {
        return { ok: false, code: 'SOLO_FOUNDER_NON_USER_OWNER', detail: `${filename} owner ${o} is not a GitHub user` };
      }
      const name = o.slice(1);
      if (name.includes('/')) {
        return {
          ok: false,
          code: 'SOLO_FOUNDER_TEAM_OWNER',
          detail: `${filename} is owned by team ${o}; solo-founder mode requires a single individual owner`,
        };
      }
      unique.add(name.toLowerCase());
    }
  }

  if (!changed_paths.length) {
    return { ok: false, code: 'UNOWNED_CHANGES', detail: 'no changed files on the PR' };
  }
  if (unique.size !== 1) {
    return {
      ok: false,
      code: 'SOLO_FOUNDER_MULTIPLE_OWNERS',
      detail: `CODEOWNERS lists multiple owners for changed paths (${[...unique].join(', ')}); require a real code-owner review`,
    };
  }
  const sole = [...unique][0];
  if (sole !== want) {
    return {
      ok: false,
      code: 'SOLO_FOUNDER_OWNER_MISMATCH',
      detail: `sole CODEOWNER is @${sole}, configured founder is ${wantAt}`,
    };
  }
  return {
    ok: true,
    evidence: {
      sole_owner: wantAt,
      changed_paths,
      owner_sets: ownerSets,
    },
  };
}

/**
 * @param {{ connector: object, config?: { codeowners_paths?: string[], approval?: object } }} deps
 */
function createApprovalService({ connector, config = {} }) {
  const codeownersPaths = config.codeowners_paths || ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
  const solo = soloConfig(config);

  async function loadCodeowners(repo, ref) {
    for (const p of codeownersPaths) {
      const r = await connector.getFileText(repo, p, ref);
      if (r.ok) return { ok: true, path: p, rules: parseCodeowners(r.data) };
      if (r.code !== 'GITHUB_NOT_FOUND') return r;
    }
    return { ok: true, path: null, rules: null };
  }

  async function isOwner(login, owners, teamCache) {
    const lower = login.toLowerCase();
    for (const o of owners) {
      if (!o.startsWith('@')) continue;
      const name = o.slice(1);
      if (!name.includes('/')) {
        if (name.toLowerCase() === lower) return { ok: true, owner: true };
        continue;
      }
      const [org, team] = name.split('/');
      const key = `${org}/${team}/${lower}`.toLowerCase();
      if (!teamCache.has(key)) {
        const m = await connector.isTeamMember(org, team, login);
        if (!m.ok) return m;
        teamCache.set(key, m.member);
      }
      if (teamCache.get(key)) return { ok: true, owner: true };
    }
    return { ok: true, owner: false };
  }

  /**
   * @param {{ repo: string, pr: number, head_sha?: string, human_ok?: boolean }} input
   */
  async function verify({ repo, pr, head_sha, human_ok = false }) {
    const reasons = [];
    const fail = (r) => ({
      ok: false,
      approved: false,
      mode: 'github_review',
      repo,
      pr,
      code: r.code,
      reasons: [...reasons, reason(r.code || 'GITHUB_API_ERROR', r.message)],
    });
    const pull = await connector.getPull(repo, pr);
    if (!pull.ok) return fail(pull);
    const prHead = pull.data.head && pull.data.head.sha;
    const authorLogin = (pull.data.user && pull.data.user.login) || '';
    const target = head_sha || prHead;
    if (head_sha && head_sha !== prHead) {
      reasons.push(reason('STALE_HEAD', `PR head is ${prHead}, expected ${head_sha}`));
    }
    if (pull.data.state === 'closed' && !pull.data.merged) reasons.push(reason('PR_CLOSED', 'PR is closed without merge'));

    const files = await connector.listPullFiles(repo, pr);
    if (!files.ok) return fail(files);
    const co = await loadCodeowners(repo, (pull.data.base && pull.data.base.ref) || 'main');
    if (!co.ok) return fail(co);

    const reviews = await connector.listReviews(repo, pr);
    if (!reviews.ok) return fail(reviews);
    const latest = latestReviewPerUser(reviews.data);
    const approvers = [];
    const teamCache = new Map();

    const authorMatchesFounder =
      solo.enabled && authorLogin && authorLogin.toLowerCase() === solo.github_login.toLowerCase();
    const sole = authorMatchesFounder
      ? soleFounderOwnership(co.rules, files.data, solo.github_login)
      : { ok: false };

    // Solo-founder path: only when enabled, author is founder, and CODEOWNERS is sole-founder.
    if (solo.enabled && authorMatchesFounder && sole.ok) {
      const soloReasons = reasons.slice();
      if (!head_sha) {
        soloReasons.push(reason(
          'SOLO_FOUNDER_HEAD_REQUIRED',
          'solo-founder approval requires --head-sha equal to the receipted work-item head'
        ));
      }
      if (!human_ok) {
        soloReasons.push(reason(
          'SOLO_FOUNDER_NOT_HUMAN',
          'solo-founder approval is only available from a human TTY (not an agent session)'
        ));
      }

      const soloMeta = {
        login: solo.github_login,
        head_sha: head_sha || null,
        codeowners_path: co.path,
        evidence: sole.evidence,
      };
      const finishSolo = (extra = {}) => ({
        ok: true,
        approved: soloReasons.length === 0,
        mode: 'solo_founder',
        repo,
        pr,
        head_sha: target,
        pr_head: prHead,
        codeowners: co.path,
        approvers: soloReasons.length === 0 ? [solo.github_login] : [],
        required_checks: extra.required_checks || [],
        checks: extra.checks || [],
        reasons: soloReasons,
        solo_founder: soloMeta,
      });

      // Head drift / missing receipted SHA: fail closed before probing checks on the wrong commit.
      if (soloReasons.some((r) => r.code === 'STALE_HEAD' || r.code === 'SOLO_FOUNDER_HEAD_REQUIRED')) {
        return finishSolo();
      }

      const rules = await connector.getBranchRules(repo, (pull.data.base && pull.data.base.ref) || 'main');
      if (!rules.ok) return fail(rules);
      const runs = await connector.listCheckRuns(repo, target);
      if (!runs.ok) return fail(runs);
      const status = await connector.getCombinedStatus(repo, target);
      if (!status.ok) return fail(status);
      const runsByName = latestRunByName(runs.data);
      const statuses = (status.data && status.data.statuses) || [];
      const required = requiredContexts(rules.data);
      const contexts = required.length ? required : [...new Set([...runsByName.keys(), ...statuses.map((s) => s.context)])];
      const checks = contexts.map((c) => evaluateCheck(c, runsByName, statuses));
      for (const c of checks) {
        if (c.state !== 'pass') {
          soloReasons.push(reason(
            `CHECK_${c.state.toUpperCase()}`,
            `${required.length ? 'required ' : ''}check ${c.context} is ${c.state}${c.conclusion ? ` (${c.conclusion})` : ''}`
          ));
        }
      }

      return finishSolo({ required_checks: required, checks });
    }

    // Normal GitHub code-owner review path (also when solo is disabled, author ≠ founder, or a second owner exists).
    if (!co.rules) {
      reasons.push(reason('NO_CODEOWNERS', `no CODEOWNERS file in ${codeownersPaths.join(', ')}`));
    } else {
      const ownerSets = new Map();
      for (const f of files.data) {
        const owners = ownersFor(co.rules, f.filename);
        if (owners.length) ownerSets.set(owners.join(' '), owners);
      }
      if (!ownerSets.size) reasons.push(reason('UNOWNED_CHANGES', 'no changed file has a code owner'));
      for (const [login, review] of latest) {
        let ownsAny = false;
        for (const owners of ownerSets.values()) {
          const o = await isOwner(login, owners, teamCache);
          if (!o.ok) return fail(o);
          if (o.owner) ownsAny = true;
        }
        if (ownsAny && review.state === 'CHANGES_REQUESTED') {
          reasons.push(reason('CHANGES_REQUESTED', `code owner ${login} requested changes`));
        }
      }
      for (const owners of ownerSets.values()) {
        let satisfied = false;
        const notes = [];
        for (const [login, review] of latest) {
          const o = await isOwner(login, owners, teamCache);
          if (!o.ok) return fail(o);
          if (review.state === 'DISMISSED') {
            notes.push(`${login}: review dismissed`);
          } else if (review.state === 'APPROVED' && review.commit_id !== target) {
            notes.push(`${login}: approved ${String(review.commit_id).slice(0, 7)}, not head ${String(target).slice(0, 7)}`);
          } else if (review.state === 'APPROVED' && !o.owner) {
            notes.push(`${login}: not a code owner`);
          } else if (review.state === 'APPROVED') {
            satisfied = true;
            if (!approvers.includes(login)) approvers.push(login);
          }
        }
        if (!satisfied) {
          reasons.push(reason('CODE_OWNER_APPROVAL_MISSING', `needs approval on head from ${owners.join(' ')}${notes.length ? ` (${notes.join('; ')})` : ''}`));
        }
      }
    }

    const rules = await connector.getBranchRules(repo, (pull.data.base && pull.data.base.ref) || 'main');
    if (!rules.ok) return fail(rules);
    const runs = await connector.listCheckRuns(repo, target);
    if (!runs.ok) return fail(runs);
    const status = await connector.getCombinedStatus(repo, target);
    if (!status.ok) return fail(status);
    const runsByName = latestRunByName(runs.data);
    const statuses = (status.data && status.data.statuses) || [];
    const required = requiredContexts(rules.data);
    const contexts = required.length ? required : [...new Set([...runsByName.keys(), ...statuses.map((s) => s.context)])];
    const checks = contexts.map((c) => evaluateCheck(c, runsByName, statuses));
    for (const c of checks) {
      if (c.state !== 'pass') {
        reasons.push(reason(`CHECK_${c.state.toUpperCase()}`, `${required.length ? 'required ' : ''}check ${c.context} is ${c.state}${c.conclusion ? ` (${c.conclusion})` : ''}`));
      }
    }

    return {
      ok: true,
      approved: reasons.length === 0,
      mode: 'github_review',
      repo,
      pr,
      head_sha: target,
      pr_head: prHead,
      codeowners: co.path,
      approvers,
      required_checks: required,
      checks,
      reasons,
    };
  }

  return { verify };
}

module.exports = {
  createApprovalService,
  latestReviewPerUser,
  latestRunByName,
  evaluateCheck,
  requiredContexts,
  soleFounderOwnership,
  soloConfig,
  PASSING,
};
