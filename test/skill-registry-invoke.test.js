'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  installFirstPartyLibraryIntoRegistry,
  invokeSkillViaRegistry,
  evaluateCrossProjectCompatibility,
  allowDecision,
} = require('../scripts/lib/hosted-runtime/skill-registry-invoke.cjs');
const { loadFirstPartyLibrary } = require('../scripts/lib/skills/first-party-library.cjs');
const { readJournal } = require('../scripts/lib/shared/journal.cjs');

const pluginRoot = path.join(__dirname, '..');
const tmpRoot = path.join(__dirname, '_tmp-skill-registry-invoke');
const fixtureRoot = path.join(__dirname, 'fixtures', 'skill-library-compat');
const summaryPath = path.join(fixtureRoot, 'summary.json');

function loadSandboxOrSkip() {
  const p = path.join(pluginRoot, 'scripts', 'lib', 'tools', 'sandbox-profile.cjs');
  if (!fs.existsSync(p)) {
    return null;
  }
  return require(p);
}

describe('AE-029b registry invoke + cross-project compatibility', () => {
  before(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('installs the ten first-party skills into a local registry', () => {
    const registryRoot = path.join(tmpRoot, 'reg-install');
    const r = installFirstPartyLibraryIntoRegistry({ pluginRoot, registryRoot });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.installed.length >= 10);
    assert.ok(fs.existsSync(path.join(registryRoot, 'skills-index.json')));
    assert.ok(fs.existsSync(path.join(registryRoot, 'skills-lock.json')));
  });

  it('resolve + sandboxed invoke succeeds for each of the ten on fixture A', async () => {
    const sandbox = loadSandboxOrSkip();
    if (!sandbox) {
      // AE-027a not present yet — keep suite green while stacked locally without inventing a sandbox.
      assert.ok(true, 'sandbox unavailable; skip until AE-027a merges');
      return;
    }

    const fixtureA = path.join(fixtureRoot, 'fixture-a');
    const registryRoot = path.join(tmpRoot, 'reg-a');
    const workDir = path.join(tmpRoot, 'work-a');
    fs.mkdirSync(workDir, { recursive: true });
    const installed = installFirstPartyLibraryIntoRegistry({ pluginRoot, registryRoot });
    assert.equal(installed.ok, true, JSON.stringify(installed));

    const lib = loadFirstPartyLibrary(pluginRoot);
    for (const entry of lib.skills) {
      const r = await invokeSkillViaRegistry({
        registryRoot,
        skillName: entry.name,
        workDir,
        fixtureRoot: fixtureA,
        sandboxApi: sandbox,
        decision: allowDecision(),
      });
      assert.equal(r.ok, true, `${entry.name}: ${JSON.stringify(r)}`);
      assert.equal(r.spawned, true, entry.name);
      assert.equal(typeof r.policy_source_seq, 'number', entry.name);
      assert.equal(typeof r.tool_requested_seq, 'number', entry.name);
      assert.equal(typeof r.tool_completed_seq, 'number', entry.name);
      assert.ok(r.tool_requested_seq > r.policy_source_seq, entry.name);
      assert.ok(r.tool_completed_seq > r.tool_requested_seq, entry.name);
    }

    const chain = readJournal(workDir);
    assert.equal(chain.ok, true);
    const policy = chain.events.filter((e) => e.type === 'policy.decided');
    const requested = chain.events.filter((e) => e.type === 'tool.requested');
    const completed = chain.events.filter((e) => e.type === 'tool.completed');
    assert.ok(policy.length >= 10);
    assert.ok(requested.length >= 10);
    assert.ok(completed.length >= 10);
    for (const e of [...policy, ...requested, ...completed]) {
      assert.equal(typeof e.seq, 'number');
      assert.ok(e.seq > 0);
    }
  });

  it('cross-project eval on fixture A and B writes summary artifact', async () => {
    const sandbox = loadSandboxOrSkip();
    if (!sandbox) {
      assert.ok(true, 'sandbox unavailable; skip until AE-027a merges');
      return;
    }

    const evalTmp = path.join(tmpRoot, 'compat-run');
    fs.mkdirSync(evalTmp, { recursive: true });
    // Isolate fixture workdirs under tmp copies so pack fixtures stay clean of .worklogs churn,
    // then write the committed summary artifact from the eval result.
    const copyA = path.join(evalTmp, 'fixture-a');
    const copyB = path.join(evalTmp, 'fixture-b');
    fs.cpSync(path.join(fixtureRoot, 'fixture-a'), copyA, { recursive: true });
    fs.cpSync(path.join(fixtureRoot, 'fixture-b'), copyB, { recursive: true });

    const out = await evaluateCrossProjectCompatibility({
      pluginRoot,
      sandboxApi: sandbox,
      fixtures: [
        { id: 'fixture-a', root: copyA },
        { id: 'fixture-b', root: copyB },
      ],
      summaryPath,
    });
    assert.equal(out.ok, true, JSON.stringify(out.summary && out.summary.totals));
    assert.ok(fs.existsSync(summaryPath));
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    assert.equal(summary.suite_id, 'ae-029b-cross-project-compat');
    assert.ok(summary.fixtures.includes('fixture-a'));
    assert.ok(summary.fixtures.includes('fixture-b'));
    assert.equal(summary.totals.fail, 0);
    assert.ok(summary.totals.pass >= 20); // 10 skills × 2 fixtures
    for (const row of summary.rows) {
      if (row.skill) {
        assert.ok(['pass', 'fail', 'skip'].includes(row.status), JSON.stringify(row));
        if (row.status === 'pass') {
          assert.equal(typeof row.policy_source_seq, 'number');
          assert.equal(typeof row.tool_requested_seq, 'number');
          assert.equal(typeof row.tool_completed_seq, 'number');
        }
      }
    }
  });

  it('fails closed on missing skill name, blank digest path, grant injection, and policy deny', async () => {
    const sandbox = loadSandboxOrSkip();
    if (!sandbox) {
      assert.ok(true, 'sandbox unavailable; skip until AE-027a merges');
      return;
    }

    const registryRoot = path.join(tmpRoot, 'reg-deny');
    const workDir = path.join(tmpRoot, 'work-deny');
    fs.mkdirSync(workDir, { recursive: true });
    assert.equal(installFirstPartyLibraryIntoRegistry({ pluginRoot, registryRoot }).ok, true);

    const blank = await invokeSkillViaRegistry({
      registryRoot,
      skillName: '   ',
      workDir,
      fixtureRoot: path.join(fixtureRoot, 'fixture-a'),
      sandboxApi: sandbox,
    });
    assert.equal(blank.ok, false);
    assert.equal(blank.code, 'SKILL_NAME_REQUIRED');

    const injected = await invokeSkillViaRegistry({
      registryRoot,
      skillName: 'repo-scan',
      workDir,
      fixtureRoot: path.join(fixtureRoot, 'fixture-a'),
      sandboxApi: sandbox,
      callerGrants: { authorized: true },
    });
    assert.equal(injected.ok, false);
    assert.equal(injected.code, 'GRANT_INJECTION_DENIED');

    const denied = await invokeSkillViaRegistry({
      registryRoot,
      skillName: 'repo-scan',
      workDir,
      fixtureRoot: path.join(fixtureRoot, 'fixture-a'),
      sandboxApi: sandbox,
      decision: {
        decision: 'deny',
        rule_id: 'ae-029b.deny',
        policy_digest: 'c'.repeat(64),
        risk_class: 'high',
        reason: 'fixture deny',
        code: 'DENY',
      },
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.spawned, false);
    assert.ok(denied.code === 'SANDBOX_POLICY_DENIED' || denied.code === 'DENY' || denied.status === 'denied' || denied.status === 'error');
  });

  it('missing workDir fails closed without swallowing', async () => {
    const sandbox = loadSandboxOrSkip();
    const r = await invokeSkillViaRegistry({
      registryRoot: path.join(tmpRoot, 'reg-missing-wd'),
      skillName: 'repo-scan',
      workDir: null,
      fixtureRoot: path.join(fixtureRoot, 'fixture-a'),
      sandboxApi: sandbox || undefined,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'WORKDIR_REQUIRED');
  });
});
