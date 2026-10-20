'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { applyTransition, loadWorkItem } = require('../scripts/lib/work-engine/engine.cjs');
const {
  detectAgentContext,
  recordApproval,
} = require('../scripts/lib/approval/human-approval.cjs');

const pluginRoot = path.join(__dirname, '..');
const identity = { name: 'Ada Human', email: 'ada@example.com', os_user: 'ada', actor: 'user:ada@example.com' };

function makeApprovalWait() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asi09-gate-'));
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
  fs.writeFileSync(path.join(wd, 'pr-link.txt'), 'https://example.com/pr/1\n');
  fs.writeFileSync(path.join(wd, 'audit.log'), '# audit\n');
  return { tmp, wd };
}

const risk = { ok: true, level: 'review', counts: { security_sensitive_path: 1, new_dependency: 0, permission_change: 0 }, flags: [{ kind: 'security_sensitive_path', path: 'src/auth/x.js', detail: 'auth' }], base: 'abc', head: 'def' };

describe('detectAgentContext', () => {
  it('refuses known agent env markers', () => {
    assert.match(detectAgentContext({ env: { CLAUDECODE: '1' }, isTTY: true }), /CLAUDECODE/);
    assert.match(detectAgentContext({ env: { CURSOR_AGENT: '1' }, isTTY: true }), /CURSOR_AGENT/);
  });
  it('refuses non-interactive stdin', () => {
    assert.match(detectAgentContext({ env: {}, isTTY: false }), /TTY/);
  });
  it('accepts a clean interactive terminal', () => {
    assert.equal(detectAgentContext({ env: { HOME: '/x' }, isTTY: true }), null);
  });
});

describe('human approval gate (engine)', () => {
  let ctx;
  beforeEach(() => {
    ctx = makeApprovalWait();
  });
  afterEach(() => fs.rmSync(ctx.tmp, { recursive: true, force: true }));

  it('blocks approval-wait → completed without an approval record', () => {
    const r = applyTransition({ workDir: ctx.wd, pluginRoot, to: 'completed', actor: 'hypervisor', skipMuscleMemory: true });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'HUMAN_APPROVAL_REQUIRED');
    assert.equal(loadWorkItem(ctx.wd, pluginRoot).state.current_state, 'approval-wait');
  });

  it('blocks when the record decision does not match the target state', () => {
    fs.writeFileSync(
      path.join(ctx.wd, 'approval-record.json'),
      JSON.stringify({ decision: 'changes_requested', approval_iter: 0, actor: identity.actor })
    );
    const r = applyTransition({
      workDir: ctx.wd,
      pluginRoot,
      to: 'completed',
      actor: 'hypervisor',
      humanApproval: { record: 'approval-record.json' },
      skipMuscleMemory: true,
    });
    assert.equal(r.code, 'HUMAN_APPROVAL_REQUIRED');
  });

  it('blocks a stale record from an earlier approval round', () => {
    const st = JSON.parse(fs.readFileSync(path.join(ctx.wd, 'state.json'), 'utf8'));
    st.counters.approval_iter = 1;
    fs.writeFileSync(path.join(ctx.wd, 'state.json'), JSON.stringify(st, null, 2));
    fs.writeFileSync(
      path.join(ctx.wd, 'approval-record.json'),
      JSON.stringify({ decision: 'approved', approval_iter: 0, actor: identity.actor })
    );
    const r = applyTransition({
      workDir: ctx.wd,
      pluginRoot,
      to: 'completed',
      actor: 'hypervisor',
      humanApproval: { record: 'approval-record.json' },
      skipMuscleMemory: true,
    });
    assert.equal(r.code, 'HUMAN_APPROVAL_REQUIRED');
  });

  it('recordApproval(approved) completes under the user identity and writes evidence', () => {
    const r = recordApproval({ workDir: ctx.wd, pluginRoot, decision: 'approved', identity, risk });
    assert.equal(r.ok, true, r.message);
    const st = loadWorkItem(ctx.wd, pluginRoot).state;
    assert.equal(st.current_state, 'completed');
    assert.equal(st.approvals.pr_approved, true);
    const last = st.history[st.history.length - 1];
    assert.equal(last.actor, 'user:ada@example.com');
    assert.deepEqual(last.evidence_refs, ['approval-record.json', 'approval-risk.json']);
    const rec = JSON.parse(fs.readFileSync(path.join(ctx.wd, 'approval-record.json'), 'utf8'));
    assert.equal(rec.decision, 'approved');
    assert.equal(rec.risk.level, 'review');
    assert.equal(rec.identity.email, 'ada@example.com');
    const audit = fs.readFileSync(path.join(ctx.wd, 'audit.log'), 'utf8');
    assert.match(audit, /actor=user:ada@example\.com action=approval decision=approved risk=review/);
  });

  it('recordApproval(changes_requested) returns to implementation with feedback', () => {
    const r = recordApproval({
      workDir: ctx.wd,
      pluginRoot,
      decision: 'changes_requested',
      note: 'Drop SKIP_CHECK.',
      identity,
      risk,
    });
    assert.equal(r.ok, true, r.message);
    const st = loadWorkItem(ctx.wd, pluginRoot).state;
    assert.equal(st.current_state, 'implementation');
    assert.equal(st.approvals.changes_requested, true);
    assert.equal(st.counters.approval_iter, 1);
    assert.match(fs.readFileSync(path.join(ctx.wd, 'approval-feedback.md'), 'utf8'), /Drop SKIP_CHECK\./);
  });

  it('a human approval can close the item after the iteration budget is spent', () => {
    const st = JSON.parse(fs.readFileSync(path.join(ctx.wd, 'state.json'), 'utf8'));
    st.budget.budget_remaining = 0;
    fs.writeFileSync(path.join(ctx.wd, 'state.json'), JSON.stringify(st, null, 2));
    const agent = applyTransition({ workDir: ctx.wd, pluginRoot, to: 'completed', actor: 'hypervisor', skipMuscleMemory: true });
    assert.equal(agent.code, 'HUMAN_APPROVAL_REQUIRED');
    const r = recordApproval({ workDir: ctx.wd, pluginRoot, decision: 'approved', identity, risk });
    assert.equal(r.ok, true, r.message);
    assert.equal(loadWorkItem(ctx.wd, pluginRoot).state.current_state, 'completed');
  });

  it('changes_requested still stops on an exhausted budget', () => {
    const st = JSON.parse(fs.readFileSync(path.join(ctx.wd, 'state.json'), 'utf8'));
    st.budget.budget_remaining = 0;
    fs.writeFileSync(path.join(ctx.wd, 'state.json'), JSON.stringify(st, null, 2));
    const r = recordApproval({ workDir: ctx.wd, pluginRoot, decision: 'changes_requested', note: 'x', identity, risk });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'BUDGET_STOP');
  });

  it('recordApproval refuses outside approval-wait', () => {
    const st = JSON.parse(fs.readFileSync(path.join(ctx.wd, 'state.json'), 'utf8'));
    st.current_state = 'validation';
    fs.writeFileSync(path.join(ctx.wd, 'state.json'), JSON.stringify(st, null, 2));
    const r = recordApproval({ workDir: ctx.wd, pluginRoot, decision: 'approved', identity, risk });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'NOT_AT_APPROVAL_WAIT');
  });

  it('CLI work approve refuses inside an agent session and leaves state unchanged', () => {
    const r = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'bin', 'agentic-swe.cjs'), 'work', 'approve', '--work-dir', ctx.wd, '--decision', 'approved', '--json'],
      { encoding: 'utf8', env: { ...process.env, CLAUDECODE: '1' } }
    );
    assert.notEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.code, 'AGENT_CONTEXT');
    assert.equal(loadWorkItem(ctx.wd, pluginRoot).state.current_state, 'approval-wait');
    assert.ok(!fs.existsSync(path.join(ctx.wd, 'approval-record.json')));
  });

  it('CLI plan-transition explains the human gate', () => {
    const r = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts', 'work-engine.cjs'), 'plan-transition', '--work-dir', ctx.wd, '--to', 'completed', '--json'],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout);
    assert.equal(out.code, 'HUMAN_APPROVAL_REQUIRED');
    assert.match(out.message, /agentic-swe work approve/);
  });
});
