'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createGitHubConnector, loadGitHubConfig } = require('../scripts/lib/github/connector.cjs');
const { createApprovalService } = require('../scripts/lib/github/approval-service.cjs');
const { memoryCallJournal } = require('../scripts/lib/github/call-journal.cjs');
const { parsePrLink, verifyAndJournal, assertGitHubVerification } = require('../scripts/lib/github/verification.cjs');
const { recordApproval } = require('../scripts/lib/approval/human-approval.cjs');
const { loadWorkItem } = require('../scripts/lib/work-engine/engine.cjs');
const { readJournal } = require('../scripts/lib/shared/journal.cjs');

const pluginRoot = path.join(__dirname, '..');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'github', 'approved-pr.json'), 'utf8')).responses;
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OLD = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const identity = { name: 'Founder', email: 'founder@example.com', os_user: 'founder', actor: 'user:founder@example.com' };
const risk = { ok: true, level: 'low', counts: {}, flags: [] };
const GH_LINK = 'https://github.com/acme/widgets/pull/42';

/** CODEOWNERS: * @founder only (base64 of "* @founder\n") */
const SOLE_CODEOWNERS_B64 = Buffer.from('* @founder\n', 'utf8').toString('base64');

function fixtureTransport(overrides = {}) {
  const responses = { ...structuredClone(FIXTURE), ...overrides };
  const requests = [];
  const transport = async ({ method, url, headers, body }) => {
    const u = new URL(url);
    requests.push({ method, path: u.pathname, search: u.search, headers, body });
    const key = `${method} ${u.pathname}`;
    if (Number(u.searchParams.get('page') || 1) > 1) {
      const first = responses[key];
      return { status: 200, data: first && first.data && first.data.check_runs ? { check_runs: [] } : [] };
    }
    const hit = responses[key];
    return hit ? structuredClone(hit) : { status: 404, data: { message: 'Not Found' } };
  };
  return { transport, requests };
}

function soloConfig(extra = {}) {
  const base = loadGitHubConfig({ pluginRoot });
  return {
    ...base,
    approval: {
      solo_founder: {
        enabled: true,
        github_login: 'founder',
        ...extra,
      },
    },
  };
}

function soleOwnerOverrides(extra = {}) {
  const pull = structuredClone(FIXTURE['GET /repos/acme/widgets/pulls/42']);
  pull.data.user = { login: 'founder' };
  return {
    'GET /repos/acme/widgets/pulls/42': pull,
    'GET /repos/acme/widgets/contents/.github/CODEOWNERS': {
      status: 200,
      data: {
        type: 'file',
        path: '.github/CODEOWNERS',
        encoding: 'base64',
        content: SOLE_CODEOWNERS_B64,
      },
    },
    'GET /repos/acme/widgets/pulls/42/files': {
      status: 200,
      data: [{ filename: 'src/index.js', status: 'modified', additions: 1, deletions: 0 }],
    },
    'GET /repos/acme/widgets/pulls/42/reviews': { status: 200, data: [] },
    ...extra,
  };
}

function service(overrides, config = soloConfig()) {
  const ft = fixtureTransport(overrides);
  const journal = memoryCallJournal();
  const connector = createGitHubConnector({ token: 'ghp_test', transport: ft.transport, journal, config });
  return { svc: createApprovalService({ connector, config }), journal, requests: ft.requests };
}

const codes = (r) => r.reasons.map((x) => x.code);

function makeApprovalWait(prLink) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solo-gate-'));
  const wd = path.join(tmp, '.worklogs', 'gate');
  fs.mkdirSync(wd, { recursive: true });
  const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
  tpl.work_id = 'gate';
  tpl.task = 'gate';
  tpl.pipeline = { ...(tpl.pipeline || {}), track: 'standard' };
  tpl.current_state = 'approval-wait';
  tpl.budget = { ...(tpl.budget || {}), budget_remaining: 10, cost_used: 0 };
  fs.writeFileSync(path.join(wd, 'state.json'), JSON.stringify(tpl, null, 2));
  fs.writeFileSync(path.join(wd, 'cicd.md'), '# CI\npass\n');
  fs.writeFileSync(path.join(wd, 'pr-link.txt'), `${prLink}\n`);
  fs.writeFileSync(path.join(wd, 'audit.log'), '# audit\n');
  return wd;
}

describe('solo-founder ApprovalService.verify', () => {
  it('enabled + all conditions + human_ok → approved with mode solo_founder', async () => {
    const { svc } = service(soleOwnerOverrides());
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD, human_ok: true });
    assert.equal(r.approved, true, JSON.stringify(r.reasons));
    assert.equal(r.mode, 'solo_founder');
    assert.deepEqual(r.approvers, ['founder']);
    assert.equal(r.solo_founder.login, 'founder');
    assert.equal(r.solo_founder.evidence.sole_owner, '@founder');
  });

  it('disabled → old behavior (CODE_OWNER_APPROVAL_MISSING without reviews)', async () => {
    const cfg = soloConfig();
    cfg.approval.solo_founder.enabled = false;
    const { svc } = service(soleOwnerOverrides(), cfg);
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD, human_ok: true });
    assert.equal(r.approved, false);
    assert.equal(r.mode, 'github_review');
    assert.ok(codes(r).includes('CODE_OWNER_APPROVAL_MISSING'));
  });

  it('author ≠ founder → falls through to review requirement', async () => {
    const pull = structuredClone(FIXTURE['GET /repos/acme/widgets/pulls/42']);
    pull.data.user = { login: 'contributor' };
    const { svc } = service({
      ...soleOwnerOverrides(),
      'GET /repos/acme/widgets/pulls/42': pull,
    });
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD, human_ok: true });
    assert.equal(r.approved, false);
    assert.equal(r.mode, 'github_review');
    assert.ok(codes(r).includes('CODE_OWNER_APPROVAL_MISSING'));
  });

  it('second code owner exists → require real review (not solo)', async () => {
    // Keep fixture CODEOWNERS (* @founder + /docs/ @docs-lead) and both files.
    const pull = structuredClone(FIXTURE['GET /repos/acme/widgets/pulls/42']);
    pull.data.user = { login: 'founder' };
    const { svc } = service({
      'GET /repos/acme/widgets/pulls/42': pull,
      'GET /repos/acme/widgets/pulls/42/reviews': { status: 200, data: [] },
    });
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD, human_ok: true });
    assert.equal(r.approved, false);
    assert.equal(r.mode, 'github_review');
    assert.ok(codes(r).includes('CODE_OWNER_APPROVAL_MISSING'));
  });

  it('head drift (receipted ≠ PR head) → fail', async () => {
    const { svc } = service(soleOwnerOverrides());
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: OLD, human_ok: true });
    assert.equal(r.approved, false);
    assert.equal(r.mode, 'solo_founder');
    assert.ok(codes(r).includes('STALE_HEAD'));
  });

  it('missing --head-sha → fail closed', async () => {
    const { svc } = service(soleOwnerOverrides());
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, human_ok: true });
    assert.equal(r.approved, false);
    assert.ok(codes(r).includes('SOLO_FOUNDER_HEAD_REQUIRED'));
  });

  it('non-TTY / agent (human_ok false) → fail', async () => {
    const { svc } = service(soleOwnerOverrides());
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD, human_ok: false });
    assert.equal(r.approved, false);
    assert.equal(r.mode, 'solo_founder');
    assert.ok(codes(r).includes('SOLO_FOUNDER_NOT_HUMAN'));
  });
});

describe('solo-founder journal + approval-record', () => {
  it('journals approved_solo_founder and writes approval-record mode', async () => {
    const wd = makeApprovalWait(GH_LINK);
    const cfg = soloConfig();
    const ft = fixtureTransport(soleOwnerOverrides());
    const journal = memoryCallJournal();
    const connector = createGitHubConnector({ token: 't', transport: ft.transport, journal, config: cfg });
    const svc = createApprovalService({ connector, config: cfg });
    const v = await verifyAndJournal({
      workDir: wd,
      service: svc,
      link: parsePrLink(wd),
      actor: identity.actor,
      headSha: HEAD,
      humanOk: true,
      calls: journal.calls,
    });
    assert.equal(v.approved, true);
    assert.equal(v.verification.verdict, 'approved_solo_founder');
    assert.equal(v.verification.mode, 'solo_founder');
    assert.equal(assertGitHubVerification({ workDir: wd, state: loadWorkItem(wd, pluginRoot).state }).ok, true);

    const r = recordApproval({
      workDir: wd,
      pluginRoot,
      decision: 'approved',
      identity,
      risk,
      mode: 'solo_founder',
      soloFounder: v.verification.solo_founder,
    });
    assert.equal(r.ok, true, r.message);
    const rec = JSON.parse(fs.readFileSync(path.join(wd, 'approval-record.json'), 'utf8'));
    assert.equal(rec.mode, 'solo_founder');
    assert.equal(rec.github_login, 'founder');
    assert.equal(rec.head_sha, HEAD);
    assert.equal(rec.codeowners.sole_owner, '@founder');
    assert.equal(loadWorkItem(wd, pluginRoot).state.current_state, 'completed');
    assert.match(fs.readFileSync(path.join(wd, 'audit.log'), 'utf8'), /verdict=approved_solo_founder mode=solo_founder/);
    assert.equal(readJournal(wd).events.find((e) => e.type === 'github.verified').state.approvals.github_verification.mode, 'solo_founder');
  });
});
