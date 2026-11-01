'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { collectFounderStatus, formatFounderStatus, costOf } = require('../scripts/lib/founder/status.cjs');
const { approveInvocation, parseArgs } = require('../scripts/founder.cjs');
const { commitState } = require('../scripts/lib/work-engine/journal.cjs');
const { AGENT_ENV_MARKERS } = require('../scripts/lib/approval/human-approval.cjs');

const root = path.join(__dirname, '..');
const founder = path.join(root, 'scripts', 'founder.cjs');
const humanEnv = { ...process.env };
for (const k of AGENT_ENV_MARKERS) delete humanEnv[k];

function template() {
  return JSON.parse(fs.readFileSync(path.join(root, 'templates', 'state.json'), 'utf8'));
}

/** A work item; `anchored` commits its state to the hash-chained journal. */
function workItem(project, id, { state = 'implementation', track = 'standard', budget = {}, reviews, prLink, anchored = true } = {}) {
  const wd = path.join(project, '.worklogs', id);
  fs.mkdirSync(wd, { recursive: true });
  const s = template();
  s.work_id = id;
  s.task = id;
  s.current_state = state;
  s.pipeline = { ...(s.pipeline || {}), track };
  s.budget = { ...(s.budget || {}), ...budget };
  if (reviews) s.reviews = reviews;
  const snapshot = anchored ? commitState(wd, s, { type: 'test.seed' }) : s;
  fs.writeFileSync(path.join(wd, 'state.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  if (prLink) fs.writeFileSync(path.join(wd, 'pr-link.txt'), `${prLink}\n`);
  return wd;
}

function goal(project, id, state) {
  const r = spawnSync(process.execPath, [
    path.join(root, 'scripts', 'goal-engine.cjs'), 'init', '--id', id, '--objective', `objective ${id}`,
    '--work-root', project, '--plugin-root', root, '--json',
  ], { encoding: 'utf8', env: humanEnv });
  assert.strictEqual(r.status, 0, r.stderr);
  const goalDir = path.join(project, '.worklogs', 'goals', id);
  if (state) {
    const g = JSON.parse(fs.readFileSync(path.join(goalDir, 'goal.json'), 'utf8'));
    g.current_state = state;
    const snap = commitState(goalDir, g, { type: 'test.seed' });
    fs.writeFileSync(path.join(goalDir, 'goal.json'), `${JSON.stringify(snap, null, 2)}\n`);
  }
  return goalDir;
}

function review(runId, findings, phase = 'code-review') {
  return { type: 'review.recorded', phase, reviewer: 'code-reviewer', model: 'm', run_id: runId, verdict: 'changes_requested', findings };
}

function fixtureProject() {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'founder-test-'));
  goal(project, 'g-active');
  goal(project, 'g-gate', 'goal-approval');
  workItem(project, 'w-approval', {
    state: 'approval-wait',
    prLink: 'https://github.com/acme/widgets/pull/42',
    budget: { cost_used: 1.25, cost_ledger: { transcript_path: '/t.jsonl', line_cursor: 10 } },
  });
  workItem(project, 'w-escalated', { state: 'escalate-code' });
  workItem(project, 'w-provider', { budget: { cost_used: 0.5, cost_ledger: { source: 'provider-reported' } } });
  workItem(project, 'w-findings', {
    state: 'code-review',
    reviews: [review('r1', [
      { id: 'F1', severity: 'high', summary: 'sql injection', resolved: false },
      { id: 'F2', severity: 'high', summary: 'fixed already', resolved: true },
      { id: 'F3', severity: 'medium', summary: 'naming', resolved: false },
      { id: 'F4', severity: 'critical', summary: 'secret in log', resolved: false },
    ])],
  });
  workItem(project, 'w-unanchored', { anchored: false });
  const tampered = workItem(project, 'w-tampered');
  const s = JSON.parse(fs.readFileSync(path.join(tampered, 'state.json'), 'utf8'));
  s.current_state = 'completed';
  fs.writeFileSync(path.join(tampered, 'state.json'), JSON.stringify(s));
  return project;
}

describe('founder status (AE-017)', () => {
  it('lists goals, items needing the founder, high findings, labeled cost, and integrity', async () => {
    const s = await collectFounderStatus({ projectRoot: fixtureProject() });
    assert.deepStrictEqual(s.goals.map((g) => [g.id, g.current_state, g.needs_human]), [
      ['g-active', 'goal-initialized', null],
      ['g-gate', 'goal-approval', 'approval'],
    ]);
    assert.deepStrictEqual(s.attention.map((a) => [a.kind, a.id, a.needs]), [
      ['goal', 'g-gate', 'approval'],
      ['work', 'w-approval', 'approval'],
      ['work', 'w-escalated', 'escalation'],
    ]);
    assert.strictEqual(s.attention[1].pr, 'https://github.com/acme/widgets/pull/42');
    assert.deepStrictEqual(s.high_findings.map((f) => [f.item, f.id, f.severity]), [
      ['w-findings', 'F1', 'high'],
      ['w-findings', 'F4', 'critical'],
    ]);
    const byId = Object.fromEntries(s.items.map((i) => [i.id, i]));
    assert.strictEqual(byId['w-approval'].cost.source, 'estimated');
    assert.strictEqual(byId['w-provider'].cost.source, 'provider-reported');
    assert.strictEqual(byId['w-escalated'].cost.source, 'none');
    assert.deepStrictEqual(s.cost, { estimated_usd: 1.25, provider_reported_usd: 0.5 });
    assert.strictEqual(byId['w-approval'].integrity, 'verified');
    assert.strictEqual(byId['w-unanchored'].integrity, 'unanchored');
    assert.match(byId['w-tampered'].integrity, /^FAILED at seq/);
    assert.deepStrictEqual(s.integrity_problems.map((p) => p.id).sort(), ['w-tampered', 'w-unanchored']);

    const text = formatFounderStatus(s);
    assert.match(text, /Needs you \(3\)/);
    assert.match(text, /\$1\.2500 estimated/);
    assert.match(text, /\$0\.5000 provider-reported/);
    assert.match(text, /F4 critical: secret in log/);
  });

  it('labels cost conservatively: only a provider-reported ledger is reported as such', () => {
    assert.strictEqual(costOf({ budget: { cost_used: 2 } }).source, 'estimated');
    assert.strictEqual(costOf({ budget: { cost_used: 2, cost_ledger: { transcript_path: 'x' } } }).source, 'estimated');
    assert.strictEqual(costOf({ budget: { cost_used: 2, cost_ledger: { source: 'provider-reported' } } }).source, 'provider-reported');
    assert.strictEqual(costOf({ budget: {} }).source, 'none');
  });

  it('makes no network calls by default', async () => {
    const real = global.fetch;
    global.fetch = () => { throw new Error('network used'); };
    try {
      const s = await collectFounderStatus({ projectRoot: fixtureProject() });
      assert.strictEqual(s.ok, true);
      assert.ok(s.items.every((i) => !i.github || i.github.live === undefined));
    } finally {
      global.fetch = real;
    }
  });

  it('consults the GitHub verifier only for approval-wait items with a GitHub PR', async () => {
    const project = fixtureProject();
    workItem(project, 'w-gh-not-waiting', { prLink: 'https://github.com/acme/widgets/pull/7' });
    const seen = [];
    const s = await collectFounderStatus({
      projectRoot: project,
      verifier: async (item) => { seen.push(item.id); return { approved: false, reasons: [{ code: 'CODE_OWNER_APPROVAL_MISSING' }] }; },
    });
    assert.deepStrictEqual(seen, ['w-approval']);
    assert.strictEqual(s.items.find((i) => i.id === 'w-approval').github.live.approved, false);
    assert.match(formatFounderStatus(s), /acme\/widgets#42 live not approved/);
  });

  it('handles a project with no worklogs', async () => {
    const s = await collectFounderStatus({ projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'founder-empty-')) });
    assert.deepStrictEqual([s.goals.length, s.items.length, s.attention.length], [0, 0, 0]);
  });
});

describe('founder CLI (AE-017)', () => {
  for (const command of [['status'], ['approve', '--work-dir', '/x', '--decision', 'approved']]) {
    it(`refuses \`${command[0]}\` in an agent session`, () => {
      const r = spawnSync(process.execPath, [founder, ...command, '--json'], { encoding: 'utf8', env: { ...humanEnv, CURSOR_AGENT: '1' } });
      assert.strictEqual(r.status, 3);
      const out = JSON.parse(r.stdout);
      assert.strictEqual(out.code, 'AGENT_CONTEXT');
      assert.match(out.message, /CURSOR_AGENT/);
    });

    it(`refuses \`${command[0]}\` without an interactive terminal`, () => {
      const r = spawnSync(process.execPath, [founder, ...command, '--json'], { encoding: 'utf8', env: humanEnv, stdio: ['pipe', 'pipe', 'pipe'] });
      assert.strictEqual(r.status, 3);
      assert.match(JSON.parse(r.stdout).message, /TTY/);
    });
  }

  it('is reachable through the agentic-swe bin and still refuses agents', () => {
    const r = spawnSync(process.execPath, [path.join(root, 'bin', 'agentic-swe.cjs'), 'founder', 'status', '--json'], {
      encoding: 'utf8', env: { ...humanEnv, CLAUDECODE: '1' },
    });
    assert.strictEqual(r.status, 3);
    assert.strictEqual(JSON.parse(r.stdout).code, 'AGENT_CONTEXT');
  });

  it('delegates approve to the work and goal engines', () => {
    const work = approveInvocation(parseArgs(['node', 'founder', 'approve', '--work-dir', 'wd', '--decision', 'approved', '--note', 'ok', '--head-sha', 'abc']), root);
    assert.strictEqual(work.ok, true);
    assert.deepStrictEqual(work.argv, [
      path.join(root, 'scripts', 'work-engine.cjs'), 'approve', '--work-dir', 'wd', '--decision', 'approved',
      '--note', 'ok', '--head-sha', 'abc', '--plugin-root', root,
    ]);
    const g = approveInvocation(parseArgs(['node', 'founder', 'approve', '--goal-dir', 'gd', '--decision', 'changes_requested', '--head-sha', 'abc']), root);
    assert.deepStrictEqual(g.argv, [
      path.join(root, 'scripts', 'goal-engine.cjs'), 'approve', '--goal-dir', 'gd', '--decision', 'changes_requested', '--plugin-root', root,
    ]);
    assert.strictEqual(approveInvocation(parseArgs(['node', 'founder', 'approve', '--work-dir', 'wd']), root).code, 'MISSING_DECISION');
    assert.strictEqual(approveInvocation(parseArgs(['node', 'founder', 'approve', '--decision', 'approved']), root).code, 'MISSING_TARGET');
    assert.strictEqual(
      approveInvocation(parseArgs(['node', 'founder', 'approve', '--work-dir', 'a', '--goal-dir', 'b', '--decision', 'approved']), root).code,
      'MISSING_TARGET'
    );
  });
});
