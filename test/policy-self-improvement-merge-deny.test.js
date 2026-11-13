'use strict';

/**
 * M4 audit item 5 / AE-035b §15 follow-up: PDP denies self-improvement
 * merge/deploy/publish without a disk human authorization record; with a
 * valid user: grant on disk, decision is require_approval (existing §15 path).
 * Non-improvement work is unchanged. Caller-supplied grants do not count.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { evaluate } = require('../scripts/lib/policy/pdp.cjs');
const {
  isSelfImprovementContext,
  isMergeDeployPublishAction,
  readDiskHumanApproval,
  evaluateSelfImprovementMergeDeploy,
} = require('../scripts/lib/policy/self-improvement-gate.cjs');
const { AUTHORIZATION_FILE } = require('../scripts/lib/policy/roles.cjs');

const fixturePolicy = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'policy-runtime', 'policy.json'), 'utf8')
);

function tmpWork(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `awe-si-pdp-${name}-`));
  const workDir = path.join(root, '.worklogs', name);
  fs.mkdirSync(workDir, { recursive: true });
  return { root, workDir };
}

function writeState(workDir, mode) {
  fs.writeFileSync(
    path.join(workDir, 'state.json'),
    JSON.stringify(
      {
        work_id: path.basename(workDir),
        current_state: 'implementation',
        mode: mode || undefined,
        pipeline: { track: 'rigorous' },
        history: [],
      },
      null,
      2
    )
  );
}

function writeHumanAuth(workDir, action = 'github.pr.write') {
  fs.writeFileSync(
    path.join(workDir, AUTHORIZATION_FILE),
    JSON.stringify(
      {
        grants: [{ action, actor: 'user:founder@example.com', at: '2026-11-13T00:00:00.000Z', note: 'test' }],
        revoked: [],
      },
      null,
      2
    )
  );
}

describe('PDP self-improvement merge/deploy deny (§15 / audit item 5)', () => {
  it('improvement actor merge denied by PDP without approval', () => {
    const { root, workDir } = tmpWork('deny-merge');
    writeState(workDir, 'self-improvement');

    const d = evaluate({
      policy: fixturePolicy,
      mode: 'self-improvement',
      workDir,
      toolName: 'github.merge',
      toolInput: { pull_number: 1 },
    });
    assert.equal(d.decision, 'deny');
    assert.equal(d.rule_id, 'section15.self_improvement_merge_deploy');
    assert.equal(d.code, 'SECTION15_DENY');
    assert.equal(d.risk_class, 'critical');

    const shell = evaluate({
      policy: fixturePolicy,
      workDir,
      toolName: 'Bash',
      toolInput: { command: 'gh pr merge 42 --squash' },
    });
    assert.equal(shell.decision, 'deny');
    assert.equal(shell.rule_id, 'section15.self_improvement_merge_deploy');

    const deploy = evaluate({
      policy: fixturePolicy,
      mode: 'self-improvement',
      workDir,
      op: 'production_deployment',
    });
    assert.equal(deploy.decision, 'deny');
    assert.equal(deploy.rule_id, 'section15.self_improvement_merge_deploy');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('with a valid human approval on disk → require_approval (§15 path)', () => {
    const { root, workDir } = tmpWork('with-auth');
    writeState(workDir, 'self-improvement');
    writeHumanAuth(workDir, 'github.pr.write');

    const d = evaluate({
      policy: fixturePolicy,
      mode: 'self-improvement',
      workDir,
      toolName: 'github.merge',
      toolInput: { protected: true, pull_number: 1 },
    });
    assert.equal(d.decision, 'require_approval');
    assert.equal(d.rule_id, 'section15.self_improvement_merge_deploy');
    assert.equal(d.code, 'SECTION15_APPROVAL');

    const publish = evaluate({
      policy: fixturePolicy,
      workDir,
      mode: 'self-improvement',
      op: 'release_publication',
    });
    assert.equal(publish.decision, 'require_approval');
    assert.equal(publish.code, 'SECTION15_APPROVAL');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('non-improvement work unchanged (regression)', () => {
    const { root, workDir } = tmpWork('normal');
    writeState(workDir, null);

    const protectedMerge = evaluate({
      policy: fixturePolicy,
      workDir,
      toolName: 'github.merge',
      toolInput: { protected: true },
    });
    assert.equal(protectedMerge.decision, 'require_approval');
    assert.equal(protectedMerge.rule_id, 'section15.protected_branch_merge');

    const deploy = evaluate({
      policy: fixturePolicy,
      workDir,
      op: 'production_deployment',
    });
    assert.equal(deploy.decision, 'require_approval');
    assert.equal(deploy.rule_id, 'section15.production_deployment');

    const publish = evaluate({
      policy: fixturePolicy,
      workDir,
      op: 'release_publication',
    });
    assert.equal(publish.decision, 'require_approval');
    assert.equal(publish.rule_id, 'section15.release_publication');

    // Unprotected github.merge on normal work is not a §15 match (pre-existing).
    const plain = evaluate({
      policy: fixturePolicy,
      workDir,
      toolName: 'github.merge',
      toolInput: { pull_number: 9 },
    });
    assert.notEqual(plain.rule_id, 'section15.self_improvement_merge_deploy');
    assert.notEqual(plain.rule_id, 'section15.protected_branch_merge');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('caller-supplied grants do not satisfy the gate (fail closed)', () => {
    const { root, workDir } = tmpWork('caller-grants');
    writeState(workDir, 'self-improvement');
    // No authorization-record.json on disk.

    const d = evaluate({
      policy: fixturePolicy,
      mode: 'self-improvement',
      workDir,
      toolName: 'github.merge',
      toolInput: { protected: true },
      // Spoofed caller grants — must be ignored for this gate.
      authorized: new Set(['github.pr.write', 'npm.publish', 'github.branch.push']),
      flags: { humanAuthorized: true, merge_authorized: true, self_improvement: true },
      actor: { role: 'hypervisor', source: 'spoof', mode: 'self-improvement' },
    });
    assert.equal(d.decision, 'deny');
    assert.equal(d.rule_id, 'section15.self_improvement_merge_deploy');
    assert.equal(d.code, 'SECTION15_DENY');

    // Agent-forged authorization with non-user actor must not count.
    fs.writeFileSync(
      path.join(workDir, AUTHORIZATION_FILE),
      JSON.stringify({
        grants: [{ action: 'github.pr.write', actor: 'agent:hypervisor', at: '2026-11-13T00:00:00.000Z' }],
        revoked: [],
      })
    );
    const forged = evaluate({
      policy: fixturePolicy,
      mode: 'self-improvement',
      workDir,
      toolName: 'github.merge',
      toolInput: { protected: true },
      authorized: new Set(['github.pr.write']),
    });
    assert.equal(forged.decision, 'deny');
    assert.equal(forged.code, 'SECTION15_DENY');

    fs.rmSync(root, { recursive: true, force: true });
  });

  it('helpers: mode from state.json; missing workDir fails closed for approval', () => {
    const { root, workDir } = tmpWork('helpers');
    writeState(workDir, 'self-improvement');
    assert.equal(isSelfImprovementContext({ workDir }), true);
    assert.equal(isSelfImprovementContext({ mode: 'lean' }), false);
    assert.equal(isMergeDeployPublishAction({ toolName: 'github.merge' }), true);
    assert.equal(isMergeDeployPublishAction({ toolName: 'Read' }), false);

    const noDir = readDiskHumanApproval(null);
    assert.equal(noDir.ok, false);

    const gate = evaluateSelfImprovementMergeDeploy({
      mode: 'self-improvement',
      toolName: 'deploy',
    });
    assert.ok(gate);
    assert.equal(gate.decision, 'deny');

    fs.rmSync(root, { recursive: true, force: true });
  });
});
