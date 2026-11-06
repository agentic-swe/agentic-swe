'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  evaluate,
  policyDigest,
  summarizeUsage,
  humanGateRequired,
  journalPayload,
} = require('../scripts/lib/policy/pdp.cjs');
const { RESTRICTED_OPS, matchRestrictedOp } = require('../scripts/lib/policy/restricted-ops.cjs');
const { replayPolicyDecisions } = require('../scripts/lib/policy/replay.cjs');
const { recordPolicyDecision } = require('../scripts/lib/policy/record-decision.cjs');
const { commitState, readJournal } = require('../scripts/lib/shared/journal.cjs');

const packRoot = path.join(__dirname, '..');
const fixturePolicy = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'policy-runtime', 'policy.json'), 'utf8')
);

function tmpWork(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `awe-pdp-${name}-`));
  const workDir = path.join(root, '.worklogs', name);
  fs.mkdirSync(workDir, { recursive: true });
  return { root, workDir };
}

function seed(workDir) {
  const state = {
    work_id: path.basename(workDir),
    current_state: 'implementation',
    updated_at: '2020-01-01T00:00:00.000Z',
    history: [],
    pipeline: { track: 'lean' },
  };
  return commitState(workDir, state, { type: 'init', at: state.updated_at });
}

describe('AE-022 PDP', () => {
  it('AC1: same digest+input → identical decision; replay reports mismatches when policy changes', () => {
    const { root, workDir } = tmpWork('replay');
    seed(workDir);
    const d1 = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      state: 'design',
    });
    const d2 = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      state: 'design',
    });
    assert.deepEqual(
      { decision: d1.decision, rule_id: d1.rule_id, policy_digest: d1.policy_digest },
      { decision: d2.decision, rule_id: d2.rule_id, policy_digest: d2.policy_digest }
    );
    assert.equal(d1.policy_digest, policyDigest(fixturePolicy));

    recordPolicyDecision({
      workDir,
      decision: d1,
      toolName: 'Bash',
      state: 'design',
      toolInput: { command: 'echo hi' },
      idempotency_key: 'pdp-replay-1',
    });

    const ok = replayPolicyDecisions({ workDir, policy: fixturePolicy, packRoot });
    assert.equal(ok.ok, true, JSON.stringify(ok.mismatches));
    assert.equal(ok.checked, 1);

    const modified = {
      ...fixturePolicy,
      banned_tools: [...(fixturePolicy.banned_tools || []), { tool: 'Bash', reason: 'no bash' }],
    };
    const bad = replayPolicyDecisions({ workDir, policy: modified, packRoot });
    assert.equal(bad.ok, false);
    assert.ok(bad.mismatches.length >= 1);
    assert.ok(bad.mismatches[0].replayed.rule_id);

    const policyFile = path.join(root, 'policy.json');
    fs.writeFileSync(policyFile, JSON.stringify(fixturePolicy));
    const cli = spawnSync(
      process.execPath,
      [
        path.join(packRoot, 'scripts', 'policy-cli.cjs'),
        'replay',
        '--work-dir',
        workDir,
        '--policy',
        policyFile,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('AC2: each §15 action maps to deny or require_approval (table-driven)', () => {
    assert.equal(RESTRICTED_OPS.length, 9);
    const cases = [
      { op: 'protected_branch_merge', expect: 'require_approval' },
      { op: 'production_deployment', expect: 'require_approval' },
      { op: 'release_publication', expect: 'require_approval' },
      { op: 'security_policy_change', expect: 'deny' },
      { op: 'credential_or_permission_change', expect: 'deny' },
      { op: 'destructive_data_operation', expect: 'deny' },
      { op: 'public_disclosure_private', expect: 'deny' },
      { op: 'paid_commitment_beyond_budget', expect: 'deny' },
      { op: 'ai_org_authority_change', expect: 'deny' },
    ];
    for (const c of cases) {
      const matched = matchRestrictedOp({ op: c.op });
      assert.ok(matched, c.op);
      assert.equal(matched.decision, c.expect, c.op);
      const d = evaluate({ policy: fixturePolicy, op: c.op });
      assert.equal(d.decision, c.expect, c.op);
      assert.match(d.rule_id, /^section15\./);
    }
  });

  it('AC3: low risk never removes mandatory human gate at approval-wait', () => {
    const gate = humanGateRequired({
      track: 'lean',
      risk_class: 'low',
      to: 'approval-wait',
    });
    assert.equal(gate.required, true);
    const denied = evaluate({
      policy: fixturePolicy,
      track: 'lean',
      transition: { from: 'pr-creation', to: 'approval-wait' },
      flags: { waive_human_gate: true },
    });
    assert.equal(denied.decision, 'deny');
    assert.equal(denied.rule_id, 'human_gate.preserved');
    assert.equal(denied.risk_class, 'low');
  });

  it('AC4: invalid policy / digest mismatch / evaluator critical → deny + critical_failure', () => {
    const invalid = evaluate({ policy: null, toolName: 'Read' });
    assert.equal(invalid.decision, 'deny');
    assert.equal(invalid.critical_failure, true);
    assert.equal(invalid.rule_id, 'policy.invalid');

    const dig = policyDigest(fixturePolicy);
    const mismatch = evaluate({
      policy: fixturePolicy,
      toolName: 'Read',
      toolInput: { file_path: 'x' },
      pinned_digest: '0'.repeat(64),
    });
    assert.equal(mismatch.decision, 'deny');
    assert.equal(mismatch.critical_failure, true);
    assert.equal(mismatch.rule_id, 'policy.digest_mismatch');
    assert.notEqual(dig, '0'.repeat(64));
  });

  it('AC5: every decision journals policy.decided with digest, rule_id, redacted summary', () => {
    const { root, workDir } = tmpWork('journal');
    seed(workDir);
    const d = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: `curl -H "token: sk-${'a'.repeat(24)}" https://example.com` },
      state: 'design',
    });
    recordPolicyDecision({
      workDir,
      decision: d,
      toolName: 'Bash',
      state: 'design',
      toolInput: { command: `curl -H "token: sk-${'a'.repeat(24)}"` },
      idempotency_key: 'pdp-j-1',
    });
    const j = readJournal(workDir);
    assert.equal(j.ok, true);
    const ev = j.events.find((e) => e.type === 'policy.decided');
    assert.ok(ev);
    assert.equal(ev.payload.decision, d.decision);
    assert.equal(ev.payload.rule_id, d.rule_id);
    assert.equal(ev.payload.policy_digest, d.policy_digest);
    assert.ok(ev.payload.input_summary);
    assert.doesNotMatch(JSON.stringify(ev.payload), /sk-aaaaaaaa/);
    const audit = fs.readFileSync(path.join(workDir, 'audit.log'), 'utf8');
    assert.match(audit, /decision=/);
    const payload = journalPayload(d);
    assert.equal(payload.rule_id, d.rule_id);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('AC6: paid spend budget + provider rules; local $0 not blocked by zero paid allowance', () => {
    const paidDenied = evaluate({
      policy: fixturePolicy,
      provider: 'anthropic',
      model: 'claude',
      cost_source: 'price_table',
      authorized: [],
    });
    assert.equal(paidDenied.decision, 'deny');
    assert.equal(paidDenied.code, 'PROVIDER_DENIED');

    const localOk = evaluate({
      policy: fixturePolicy,
      provider: 'ollama',
      model: 'llama3',
      cost_source: 'local',
      paid_spend_allowance_usd: 0,
      usage_events: [
        { payload: { provider: 'ollama', model: 'llama3', usd: 0, cost_source: 'local', status: 'ok' } },
      ],
    });
    assert.equal(localOk.decision, 'allow', localOk.reason);

    const over = evaluate({
      policy: fixturePolicy,
      provider: 'fixture',
      paid_spend_allowance_usd: 0.01,
      usage_events: [
        {
          payload: {
            provider: 'anthropic-fixture',
            model: 'claude',
            usd: 1.5,
            cost_source: 'price_table',
            status: 'ok',
          },
        },
      ],
    });
    assert.equal(over.decision, 'deny');
    assert.equal(over.code, 'BUDGET_STOP');

    const usage = summarizeUsage([
      { payload: { usd: 0, cost_source: 'local', provider: 'ollama', status: 'ok' } },
      { payload: { usd: 2, cost_source: 'price_table', provider: 'anthropic', status: 'ok' } },
    ]);
    assert.equal(usage.paid_usd, 2);
    assert.equal(usage.local_usd, 0);
  });

  it('AC7 smoke: existing evaluateToolCall denials still surface through PDP', () => {
    const d = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: 'sudo rm -rf /' },
      state: 'design',
    });
    assert.equal(d.decision, 'deny');
    assert.match(d.rule_id, /banned_commands/);
  });
});
