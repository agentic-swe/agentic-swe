'use strict';

/**
 * AE-039b / PD-57: require_approval pause/resume human gate.
 * Missing or forged approvals do not resume. Not a default-policy edit.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

const {
  REQUEST_FILE,
  RECORD_FILE,
  resolveRequireApproval,
  recordPolicyToolApproval,
  requestId,
} = require('../scripts/lib/approval/policy-pause.cjs');
const { evaluate } = require('../scripts/lib/policy/pdp.cjs');

const pluginRoot = path.join(__dirname, '..');
const hook = path.join(pluginRoot, 'scripts', 'hook-pre-tool-policy.cjs');
const fixturePolicy = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'policy-runtime', 'policy.json'), 'utf8')
);
const DEFAULT_POLICY_SHA = crypto
  .createHash('sha256')
  .update(fs.readFileSync(path.join(pluginRoot, 'config', 'default-policy.json')))
  .digest('hex');

function tmpWork(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `awe-pause-${name}-`));
  const workDir = path.join(root, '.worklogs', name);
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(
    path.join(workDir, 'state.json'),
    JSON.stringify({
      work_id: name,
      current_state: 'implementation',
      pipeline: { track: 'standard' },
      history: [],
    })
  );
  fs.writeFileSync(path.join(workDir, 'audit.log'), '# audit\n');
  return { root, workDir };
}

function requireApprovalDecision(overrides = {}) {
  return evaluate({
    policy: fixturePolicy,
    workDir: overrides.workDir,
    toolName: 'github.merge',
    toolInput: { protected: true, pull_number: 7 },
    ...overrides,
  });
}

describe('AE-039b require_approval pause/resume', () => {
  it('pauses: writes approval request artifact and does not resume without a record', () => {
    const { root, workDir } = tmpWork('pause');
    const decision = requireApprovalDecision({ workDir });
    assert.equal(decision.decision, 'require_approval');

    const gate = resolveRequireApproval({
      workDir,
      toolName: 'github.merge',
      decision,
    });
    assert.equal(gate.paused, true);
    assert.equal(gate.resumed, false);
    assert.match(gate.reason, /paused for human approval/);
    assert.equal(fs.existsSync(path.join(workDir, REQUEST_FILE)), true);
    const req = JSON.parse(fs.readFileSync(path.join(workDir, REQUEST_FILE), 'utf8'));
    assert.equal(req.rule_id, decision.rule_id);
    assert.equal(req.id, requestId({
      toolName: 'github.merge',
      rule_id: decision.rule_id,
      policy_digest: decision.policy_digest,
      input_summary: decision.input_summary,
      reason: decision.reason,
    }));

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resumes only after a recorded human user: approval matching the request', () => {
    const { root, workDir } = tmpWork('resume');
    const decision = requireApprovalDecision({ workDir });
    const paused = resolveRequireApproval({
      workDir,
      toolName: 'github.merge',
      decision,
    });
    assert.equal(paused.resumed, false);

    const recorded = recordPolicyToolApproval({
      workDir,
      identity: { actor: 'user:founder@example.com' },
      note: 'ship it',
    });
    assert.equal(recorded.ok, true, recorded.reason);

    const resumed = resolveRequireApproval({
      workDir,
      toolName: 'github.merge',
      decision,
    });
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.paused, false);
    assert.match(resumed.reason, /human approved/);
    assert.equal(resumed.record.actor, 'user:founder@example.com');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('missing approval does not resume', () => {
    const { root, workDir } = tmpWork('missing');
    const decision = requireApprovalDecision({ workDir });
    resolveRequireApproval({ workDir, toolName: 'github.merge', decision });
    // Explicitly ensure no record file.
    assert.equal(fs.existsSync(path.join(workDir, RECORD_FILE)), false);
    const again = resolveRequireApproval({ workDir, toolName: 'github.merge', decision });
    assert.equal(again.resumed, false);
    assert.match(again.reason, /missing or unreadable/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('forged approval (agent actor or wrong request_id) does not resume', () => {
    const { root, workDir } = tmpWork('forged');
    const decision = requireApprovalDecision({ workDir });
    const paused = resolveRequireApproval({ workDir, toolName: 'github.merge', decision });
    const req = paused.request;

    fs.writeFileSync(
      path.join(workDir, RECORD_FILE),
      JSON.stringify({
        schema_version: 1,
        request_id: req.id,
        decision: 'approved',
        actor: 'agent:hypervisor',
        at: new Date().toISOString(),
      })
    );
    const forgedActor = resolveRequireApproval({ workDir, toolName: 'github.merge', decision });
    assert.equal(forgedActor.resumed, false);
    assert.match(forgedActor.reason, /not a user:/);

    fs.writeFileSync(
      path.join(workDir, RECORD_FILE),
      JSON.stringify({
        schema_version: 1,
        request_id: 'deadbeef',
        decision: 'approved',
        actor: 'user:founder@example.com',
        at: new Date().toISOString(),
      })
    );
    const forgedId = resolveRequireApproval({ workDir, toolName: 'github.merge', decision });
    assert.equal(forgedId.resumed, false);
    assert.match(forgedId.reason, /request_id does not match/);

    // recordPolicyToolApproval rejects non-user identities.
    const bad = recordPolicyToolApproval({
      workDir,
      identity: { actor: 'agent:bot' },
    });
    assert.equal(bad.ok, false);

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('hook: require_approval blocks until human approval, then allows', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-pause-hook-'));
    fs.mkdirSync(path.join(repo, '.agentic-swe'));
    fs.copyFileSync(
      path.join(__dirname, 'fixtures', 'policy-runtime', 'policy.json'),
      path.join(repo, '.agentic-swe', 'policy.json')
    );
    const workDir = path.join(repo, '.worklogs', 'hook');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({
        work_id: 'hook',
        current_state: 'implementation',
        pipeline: { track: 'standard' },
      })
    );
    fs.writeFileSync(path.join(workDir, 'audit.log'), '# audit\n');

    const env = {
      ...process.env,
      AGENTIC_SWE_WORK_DIR: workDir,
    };
    delete env.AGENTIC_SWE_POLICY;
    const input = {
      tool_name: 'github.merge',
      tool_input: { protected: true, pull_number: 3 },
      cwd: repo,
    };

    const paused = spawnSync(process.execPath, [hook], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env,
    });
    assert.equal(paused.status, 2, paused.stderr);
    assert.match(paused.stderr, /paused for human approval|human approval/i);
    assert.equal(fs.existsSync(path.join(workDir, REQUEST_FILE)), true);

    const recorded = recordPolicyToolApproval({
      workDir,
      identity: { actor: 'user:ada@example.com' },
    });
    assert.equal(recorded.ok, true, recorded.reason);

    const resumed = spawnSync(process.execPath, [hook], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env,
    });
    assert.equal(resumed.status, 0, resumed.stderr);
    const audit = fs.readFileSync(path.join(workDir, 'audit.log'), 'utf8');
    assert.match(audit, /decision=allow/);
    assert.match(audit, /policy_tool_approval decision=approved/);

    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('does not edit config/default-policy.json', () => {
    const sha = crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(pluginRoot, 'config', 'default-policy.json')))
      .digest('hex');
    assert.equal(sha, DEFAULT_POLICY_SHA);
  });
});
