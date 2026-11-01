'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createGitHubConnector, loadGitHubConfig } = require('../scripts/lib/github/connector.cjs');
const { createApprovalService } = require('../scripts/lib/github/approval-service.cjs');
const { parseCodeowners, ownersFor } = require('../scripts/lib/github/codeowners.cjs');
const { fileCallJournal, memoryCallJournal, readCalls } = require('../scripts/lib/github/call-journal.cjs');
const { parsePrLink, verifyAndJournal, assertGitHubVerification } = require('../scripts/lib/github/verification.cjs');
const { applyTransition, loadWorkItem } = require('../scripts/lib/work-engine/engine.cjs');
const { recordApproval } = require('../scripts/lib/approval/human-approval.cjs');
const { readJournal } = require('../scripts/lib/work-engine/journal.cjs');

const pluginRoot = path.join(__dirname, '..');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'github', 'approved-pr.json'), 'utf8')).responses;
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const OLD = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const identity = { name: 'Ada Human', email: 'ada@example.com', os_user: 'ada', actor: 'user:ada@example.com' };
const config = loadGitHubConfig({ pluginRoot });

/** Replays recorded responses keyed by "METHOD /path"; pagination beyond page 1 is empty. */
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

function service(overrides) {
  const ft = fixtureTransport(overrides);
  const journal = memoryCallJournal();
  const connector = createGitHubConnector({ token: 'ghp_test', transport: ft.transport, journal, config });
  return { svc: createApprovalService({ connector, config }), journal, requests: ft.requests, connector };
}

function withReviews(reviews) {
  return { 'GET /repos/acme/widgets/pulls/42/reviews': { status: 200, data: reviews } };
}

function review(id, login, state, commit = HEAD, at = '2026-10-31T10:00:00Z') {
  return { id, user: { login }, state, commit_id: commit, submitted_at: at };
}

const codes = (r) => r.reasons.map((x) => x.code);

describe('GitHub connector (read-only)', () => {
  it('retrieves issues, PR metadata, reviews, and check runs from recorded fixtures', async () => {
    const { connector, requests } = service();
    const issue = await connector.getIssue('acme/widgets', 7);
    assert.equal(issue.data.title, 'Widgets crash on empty input');
    const pr = await connector.getPull('acme/widgets', 42);
    assert.equal(pr.data.head.sha, HEAD);
    const reviews = await connector.listReviews('acme/widgets', 42);
    assert.equal(reviews.data.length, 2);
    const runs = await connector.listCheckRuns('acme/widgets', HEAD);
    assert.deepEqual(runs.data.map((r) => r.name), ['test (20)', 'test (22)']);
    assert.ok(requests.every((r) => r.method === 'GET'));
    assert.ok(requests.every((r) => r.headers.Authorization === 'Bearer ghp_test'));
  });

  it('declares least-privilege read permissions and keeps writes off by default', () => {
    assert.ok(config.permissions.read.includes('pull_requests:read'));
    assert.ok(config.permissions.read.every((p) => p.endsWith(':read')));
    assert.equal(config.authorization.github_write, false);
  });

  it('rejects a malformed repo before any call', () => {
    const { connector, requests } = service();
    assert.throws(() => connector.getPull('../etc', 1), /owner\/name/);
    assert.equal(requests.length, 0);
  });

  it('requires a journal sink', () => {
    assert.throws(() => createGitHubConnector({ token: 't', config }), /journal/);
  });
});

describe('GitHub writes behind authorization.github_write', () => {
  it('branch push, PR creation, comments, and check runs return DENIED_UNAUTHORIZED with the flag off', async () => {
    const { connector, requests, journal } = service();
    const results = [
      await connector.createBranch('acme/widgets', { ref: 'feat/x', sha: HEAD }),
      await connector.createPull('acme/widgets', { title: 't', head: 'feat/x', base: 'main' }),
      await connector.createComment('acme/widgets', 42, 'hi'),
      await connector.createCheckRun('acme/widgets', { name: 'x', head_sha: HEAD }),
    ];
    for (const r of results) assert.equal(r.code, 'DENIED_UNAUTHORIZED');
    assert.equal(requests.length, 0);
    assert.deepEqual(journal.calls.map((c) => c.status), ['denied', 'denied', 'denied', 'denied']);
  });

  it('a repo .agentic-swe/github.json with github_write: true lets writes through', async () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-write-'));
    fs.mkdirSync(path.join(project, '.agentic-swe'));
    fs.writeFileSync(path.join(project, '.agentic-swe', 'github.json'), JSON.stringify({ authorization: { github_write: true } }));
    const writeConfig = loadGitHubConfig({ pluginRoot, projectRoot: project });
    const ft = fixtureTransport({ 'POST /repos/acme/widgets/issues/42/comments': { status: 201, data: { id: 1 } } });
    const connector = createGitHubConnector({ token: 't', transport: ft.transport, journal: memoryCallJournal(), config: writeConfig });
    const r = await connector.createComment('acme/widgets', 42, 'hi');
    assert.equal(r.ok, true);
    assert.deepEqual(ft.requests[0].body, { body: 'hi' });
  });

  it('only an explicit true enables writes', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-write-'));
    fs.mkdirSync(path.join(project, '.agentic-swe'));
    fs.writeFileSync(path.join(project, '.agentic-swe', 'github.json'), JSON.stringify({ authorization: { github_write: 'yes' } }));
    assert.equal(loadGitHubConfig({ pluginRoot, projectRoot: project }).authorization.github_write, false);
  });
});

describe('GitHub call journal', () => {
  it('records method, endpoint, and status of every call in a hash chain', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-calls-'));
    const journal = fileCallJournal(dir);
    const ft = fixtureTransport();
    const connector = createGitHubConnector({ token: 't', transport: ft.transport, journal, config });
    await connector.getPull('acme/widgets', 42);
    await connector.getIssue('acme/widgets', 404);
    await connector.createComment('acme/widgets', 42, 'x');
    const chain = readCalls(journal.file);
    assert.equal(chain.ok, true);
    assert.deepEqual(chain.events.map((e) => [e.call.method, e.call.endpoint, e.call.status]), [
      ['GET', '/repos/acme/widgets/pulls/42', 200],
      ['GET', '/repos/acme/widgets/issues/404', 404],
      ['POST', '/repos/acme/widgets/issues/42/comments', 'denied'],
    ]);
    const lines = fs.readFileSync(journal.file, 'utf8').split('\n');
    lines[0] = lines[0].replace('"status":200', '"status":201');
    fs.writeFileSync(journal.file, lines.join('\n'));
    assert.equal(readCalls(journal.file).ok, false);
  });

  it('records network failures as status 0', async () => {
    const journal = memoryCallJournal();
    const connector = createGitHubConnector({ token: 't', transport: async () => { throw new Error('ECONNRESET'); }, journal, config });
    const r = await connector.getPull('acme/widgets', 42);
    assert.equal(r.code, 'GITHUB_NETWORK_ERROR');
    assert.deepEqual(journal.calls, [{ method: 'GET', endpoint: '/repos/acme/widgets/pulls/42', status: 0 }]);
  });
});

describe('CODEOWNERS matching', () => {
  const rules = parseCodeowners('*  @founder\n/docs/ @docs-lead\ndocs/api/*.md @api\n*.lock\n');
  it('applies the last matching rule', () => {
    assert.deepEqual(ownersFor(rules, 'src/index.js'), ['@founder']);
    assert.deepEqual(ownersFor(rules, 'docs/guide.md'), ['@docs-lead']);
    assert.deepEqual(ownersFor(rules, 'docs/api/x.md'), ['@api']);
    assert.deepEqual(ownersFor(rules, 'docs/api/v2/x.md'), ['@docs-lead']);
  });
  it('a rule without owners leaves the path unowned', () => {
    assert.deepEqual(ownersFor(rules, 'package.lock'), []);
  });
});

describe('ApprovalService.verify', () => {
  it('approves code-owner reviews on the head SHA with green required checks', async () => {
    const { svc } = service();
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD });
    assert.equal(r.approved, true, JSON.stringify(r.reasons));
    assert.deepEqual(r.approvers.sort(), ['docs-lead', 'founder']);
    assert.deepEqual(r.required_checks, ['test (20)', 'test (22)']);
  });

  it('rejects a review on a stale SHA', async () => {
    const { svc } = service(withReviews([review(1, 'founder', 'APPROVED', OLD), review(2, 'docs-lead', 'APPROVED')]));
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD });
    assert.equal(r.approved, false);
    assert.deepEqual(codes(r), ['CODE_OWNER_APPROVAL_MISSING']);
    assert.match(r.reasons[0].detail, /founder: approved deadbee, not head a1b2c3d/);
  });

  it('rejects when the PR head moved past the SHA being approved', async () => {
    const { svc } = service();
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: OLD });
    assert.equal(r.approved, false);
    assert.ok(codes(r).includes('STALE_HEAD'));
  });

  it('rejects an approval from someone who is not a code owner', async () => {
    const { svc } = service(withReviews([review(1, 'random-dev', 'APPROVED'), review(2, 'docs-lead', 'APPROVED')]));
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD });
    assert.equal(r.approved, false);
    assert.deepEqual(codes(r), ['CODE_OWNER_APPROVAL_MISSING']);
    assert.match(r.reasons[0].detail, /random-dev: not a code owner/);
  });

  it('rejects a dismissed review', async () => {
    const { svc } = service(withReviews([review(1, 'founder', 'DISMISSED'), review(2, 'docs-lead', 'APPROVED')]));
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD });
    assert.equal(r.approved, false);
    assert.match(r.reasons[0].detail, /founder: review dismissed/);
  });

  it('uses each reviewer\'s latest review: approval then changes requested is not approved', async () => {
    const { svc } = service(withReviews([
      review(1, 'founder', 'APPROVED', HEAD, '2026-10-31T10:00:00Z'),
      review(2, 'docs-lead', 'APPROVED'),
      review(3, 'founder', 'CHANGES_REQUESTED', HEAD, '2026-10-31T11:00:00Z'),
      review(4, 'founder', 'COMMENTED', HEAD, '2026-10-31T12:00:00Z'),
    ]));
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD });
    assert.equal(r.approved, false);
    assert.deepEqual(codes(r).sort(), ['CHANGES_REQUESTED', 'CODE_OWNER_APPROVAL_MISSING']);
  });

  it('accepts a team owner when the reviewer is an active team member', async () => {
    const { svc } = service({
      ...withReviews([review(1, 'founder', 'APPROVED'), review(2, 'writer', 'APPROVED')]),
      'GET /orgs/acme/teams/docs/memberships/writer': { status: 200, data: { state: 'active' } },
    });
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD });
    assert.equal(r.approved, true, JSON.stringify(r.reasons));
  });

  it('rejects failing, pending, and missing required checks', async () => {
    const { svc } = service({
      [`GET /repos/acme/widgets/commits/${HEAD}/check-runs`]: {
        status: 200,
        data: { check_runs: [{ id: 1, name: 'test (20)', status: 'completed', conclusion: 'failure' }] },
      },
    });
    const r = await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD });
    assert.deepEqual(codes(r), ['CHECK_FAIL', 'CHECK_MISSING']);
    const pending = service({
      [`GET /repos/acme/widgets/commits/${HEAD}/check-runs`]: {
        status: 200,
        data: { check_runs: [
          { id: 1, name: 'test (20)', status: 'in_progress', conclusion: null },
          { id: 2, name: 'test (22)', status: 'completed', conclusion: 'success' },
        ] },
      },
    });
    assert.deepEqual(codes(await pending.svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD })), ['CHECK_PENDING']);
  });

  it('a re-run that passed replaces the earlier failed run', async () => {
    const { svc } = service({
      [`GET /repos/acme/widgets/commits/${HEAD}/check-runs`]: {
        status: 200,
        data: { check_runs: [
          { id: 1, name: 'test (20)', status: 'completed', conclusion: 'failure' },
          { id: 3, name: 'test (20)', status: 'completed', conclusion: 'success' },
          { id: 2, name: 'test (22)', status: 'completed', conclusion: 'success' },
        ] },
      },
    });
    assert.equal((await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD })).approved, true);
  });

  it('fails closed without CODEOWNERS or when the API errors', async () => {
    const noOwners = service({ 'GET /repos/acme/widgets/contents/.github/CODEOWNERS': { status: 404, data: { message: 'Not Found' } } });
    assert.ok(codes(await noOwners.svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD })).includes('NO_CODEOWNERS'));
    const broken = service({ 'GET /repos/acme/widgets/pulls/42/reviews': { status: 500, data: { message: 'boom' } } });
    const r = await broken.svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD });
    assert.equal(r.approved, false);
    assert.equal(r.code, 'GITHUB_API_ERROR');
  });

  it('rejects a PR closed without merge', async () => {
    const pull = structuredClone(FIXTURE['GET /repos/acme/widgets/pulls/42']);
    pull.data.state = 'closed';
    const { svc } = service({ 'GET /repos/acme/widgets/pulls/42': pull });
    assert.ok(codes(await svc.verify({ repo: 'acme/widgets', pr: 42, head_sha: HEAD })).includes('PR_CLOSED'));
  });
});

function makeApprovalWait(prLink) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-gate-'));
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

const risk = { ok: true, level: 'low', counts: {}, flags: [] };
const GH_LINK = 'https://github.com/acme/widgets/pull/42';

async function verifyWith(wd, overrides) {
  const { svc, journal } = service(overrides);
  return verifyAndJournal({ workDir: wd, service: svc, link: parsePrLink(wd), actor: identity.actor, headSha: HEAD, calls: journal.calls });
}

describe('approval-wait → completed with a GitHub PR', () => {
  it('parses github.com PR links only', () => {
    assert.deepEqual(parsePrLink(makeApprovalWait(GH_LINK)), { repo: 'acme/widgets', pr: 42, url: GH_LINK });
    assert.equal(parsePrLink(makeApprovalWait('https://example.com/pr/1')), null);
  });

  it('is blocked without a github.verified event even with a local approval record', () => {
    const wd = makeApprovalWait(GH_LINK);
    const r = recordApproval({ workDir: wd, pluginRoot, decision: 'approved', identity, risk });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'GITHUB_APPROVAL_REQUIRED');
    assert.equal(loadWorkItem(wd, pluginRoot).state.current_state, 'approval-wait');
  });

  it('completes after an approved verdict, which is journaled with its API calls', async () => {
    const wd = makeApprovalWait(GH_LINK);
    const v = await verifyWith(wd);
    assert.equal(v.approved, true);
    const ev = readJournal(wd).events.at(-1);
    assert.equal(ev.type, 'github.verified');
    const gv = ev.state.approvals.github_verification;
    assert.equal(gv.verdict, 'approved');
    assert.equal(gv.head_sha, HEAD);
    assert.ok(gv.calls.some((c) => c.endpoint.startsWith('/repos/acme/widgets/pulls/42/reviews?') && c.status === 200));
    assert.match(fs.readFileSync(path.join(wd, 'audit.log'), 'utf8'), /action=github_verified verdict=approved pr=acme\/widgets#42/);
    const r = recordApproval({ workDir: wd, pluginRoot, decision: 'approved', identity, risk });
    assert.equal(r.ok, true, r.message);
    assert.equal(loadWorkItem(wd, pluginRoot).state.current_state, 'completed');
  });

  it('a not-approved verdict is journaled and keeps the gate closed', async () => {
    const wd = makeApprovalWait(GH_LINK);
    const v = await verifyWith(wd, withReviews([review(1, 'founder', 'DISMISSED')]));
    assert.equal(v.approved, false);
    assert.equal(readJournal(wd).events.at(-1).state.approvals.github_verification.verdict, 'not_approved');
    const r = recordApproval({ workDir: wd, pluginRoot, decision: 'approved', identity, risk });
    assert.equal(r.code, 'GITHUB_APPROVAL_REQUIRED');
    assert.match(r.message, /CODE_OWNER_APPROVAL_MISSING/);
  });

  it('a verdict for another PR or an earlier round does not open the gate', async () => {
    const wd = makeApprovalWait(GH_LINK);
    await verifyWith(wd);
    fs.writeFileSync(path.join(wd, 'pr-link.txt'), 'https://github.com/acme/widgets/pull/43\n');
    assert.match(assertGitHubVerification({ workDir: wd, state: loadWorkItem(wd, pluginRoot).state }).message, /acme\/widgets#42/);
    fs.writeFileSync(path.join(wd, 'pr-link.txt'), `${GH_LINK}\n`);
    const state = loadWorkItem(wd, pluginRoot).state;
    state.counters = { ...(state.counters || {}), approval_iter: 1 };
    assert.match(assertGitHubVerification({ workDir: wd, state }).message, /approval round 0/);
  });

  it('a hand-edited state.json verdict does not open the gate', async () => {
    const wd = makeApprovalWait(GH_LINK);
    await verifyWith(wd, withReviews([]));
    assert.equal(recordApproval({ workDir: wd, pluginRoot, decision: 'approved', identity, risk }).code, 'GITHUB_APPROVAL_REQUIRED');
    const statePath = path.join(wd, 'state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    state.approvals.github_verification.verdict = 'approved';
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    const r = applyTransition({ workDir: wd, pluginRoot, to: 'completed', actor: 'hypervisor', humanApproval: { record: 'approval-record.json' }, skipMuscleMemory: true });
    assert.equal(r.code, 'GITHUB_APPROVAL_REQUIRED');
  });

  it('a non-GitHub PR link keeps the local approval record only', () => {
    const wd = makeApprovalWait('https://example.com/pr/1');
    const r = recordApproval({ workDir: wd, pluginRoot, decision: 'approved', identity, risk });
    assert.equal(r.ok, true, r.message);
    assert.equal(loadWorkItem(wd, pluginRoot).state.current_state, 'completed');
  });

  it('changes_requested does not need GitHub verification', () => {
    const wd = makeApprovalWait(GH_LINK);
    const r = recordApproval({ workDir: wd, pluginRoot, decision: 'changes_requested', note: 'fix', identity, risk });
    assert.equal(r.ok, true, r.message);
    assert.equal(loadWorkItem(wd, pluginRoot).state.current_state, 'implementation');
  });
});
