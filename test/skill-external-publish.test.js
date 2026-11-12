'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  publishExternalContribution,
  PRIVATE_ORG_ORIGINS,
  normalizeApprovalRef,
  normalizePublishActor,
} = require('../scripts/lib/skills/skill-external-publish.cjs');
const {
  validateSkillContribution,
  formatContributionResult,
} = require('../scripts/lib/skills/skill-contribution-validate.cjs');
const {
  checkCommitDco,
  checkCommitsDco,
  formatDcoResult,
} = require('../scripts/lib/skills/dco-check.cjs');
const { readRegistryLog, gitTagRef } = require('../scripts/lib/skills/skill-registry.cjs');

const root = path.resolve(__dirname, '..');
const fixtures = path.join(root, 'test', 'fixtures', 'skill-external-contribution');
const goodDir = path.join(fixtures, 'good', 'contrib-external-example');
const privateDir = path.join(fixtures, 'private-origin', 'contrib-private-example');
const msgDir = path.join(fixtures, 'dco-messages');
const tmpRoot = path.join(__dirname, '_tmp-skill-external-publish');

function loadMsg(name) {
  return fs.readFileSync(path.join(msgDir, name), 'utf8');
}

function readDigest(dir) {
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  return String(m.digest).toLowerCase();
}

describe('AE-028b governed external publication', () => {
  before(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('refuses blank actor and blank approval (fail closed)', () => {
    const registry = path.join(tmpRoot, 'reg-blank');
    assert.throws(() => normalizePublishActor(''), { code: 'ACTOR_REQUIRED' });
    assert.throws(() => normalizePublishActor('   '), { code: 'ACTOR_REQUIRED' });
    assert.throws(() => normalizeApprovalRef(''), { code: 'APPROVAL_REQUIRED' });
    assert.throws(() => normalizeApprovalRef(null), { code: 'APPROVAL_REQUIRED' });

    const noActor = publishExternalContribution({
      registryRoot: registry,
      sourceDir: goodDir,
      actor: '  ',
      approvalRef: 'PR#1',
    });
    assert.equal(noActor.ok, false);
    assert.equal(noActor.code, 'ACTOR_REQUIRED');

    const noApproval = publishExternalContribution({
      registryRoot: registry,
      sourceDir: goodDir,
      actor: 'maintainer:test',
      approvalRef: '',
    });
    assert.equal(noApproval.ok, false);
    assert.equal(noApproval.code, 'APPROVAL_REQUIRED');

    const missingApproval = publishExternalContribution({
      registryRoot: registry,
      sourceDir: goodDir,
      actor: 'maintainer:test',
    });
    assert.equal(missingApproval.ok, false);
    assert.equal(missingApproval.code, 'APPROVAL_REQUIRED');
  });

  it('refuses private/org provenance.origin (§16)', () => {
    for (const origin of PRIVATE_ORG_ORIGINS) {
      assert.ok(typeof origin === 'string' && origin.length > 0);
    }
    const registry = path.join(tmpRoot, 'reg-private');
    const refused = publishExternalContribution({
      registryRoot: registry,
      sourceDir: privateDir,
      actor: 'maintainer:test',
      approvalRef: 'PR#99',
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'PRIVATE_PROVENANCE_FORBIDDEN');
    assert.equal(fs.existsSync(path.join(registry, 'skills')), false);
  });

  it('refuses blank expectedDigest and digest mismatch', () => {
    const registry = path.join(tmpRoot, 'reg-digest');
    const blankExpected = publishExternalContribution({
      registryRoot: registry,
      sourceDir: goodDir,
      actor: 'maintainer:test',
      approvalRef: 'PR#2',
      expectedDigest: '   ',
    });
    assert.equal(blankExpected.ok, false);
    assert.equal(blankExpected.code, 'DIGEST_EXPECTED_BLANK');

    const mismatch = publishExternalContribution({
      registryRoot: registry,
      sourceDir: goodDir,
      actor: 'maintainer:test',
      approvalRef: 'PR#2',
      expectedDigest: '0'.repeat(64),
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'DIGEST_MISMATCH');
  });

  it('happy path: approval present → published with tag ref + approval_ref in log', () => {
    const registry = path.join(tmpRoot, 'reg-happy');
    const digest = readDigest(goodDir);
    const pub = publishExternalContribution({
      registryRoot: registry,
      sourceDir: goodDir,
      actor: 'maintainer:alice',
      approvalRef: 'PR#42',
      expectedDigest: digest,
    });
    assert.equal(pub.ok, true, JSON.stringify(pub));
    assert.equal(pub.tag, gitTagRef('contrib-external-example', '1.0.0'));
    assert.equal(pub.tag, 'skill/contrib-external-example/v1.0.0');
    assert.equal(pub.approvalRef, 'PR#42');
    assert.equal(pub.digest, digest);
    assert.ok(fs.existsSync(path.join(registry, 'skills', 'contrib-external-example', '1.0.0', 'SKILL.md')));

    const log = readRegistryLog(registry);
    const publishLine = log.find((e) => e.action === 'publish');
    assert.ok(publishLine, 'publish audit line missing');
    assert.equal(publishLine.actor, 'maintainer:alice');
    assert.equal(publishLine.approval_ref, 'PR#42');
    assert.equal(publishLine.tag, pub.tag);
    assert.equal(publishLine.digest, digest);
  });
});

describe('AE-028b offline dry-run (validator → DCO → publish gates)', () => {
  before(() => {
    fs.mkdirSync(tmpRoot, { recursive: true });
  });

  it('exercises the full external path offline', () => {
    // 1) Contribution validator passes on the fixture skill
    const validated = validateSkillContribution(goodDir);
    assert.equal(validated.ok, true, formatContributionResult(validated));

    // 2) DCO: signed fixture passes; unsigned fails
    const signed = checkCommitDco({
      hash: 'aa11',
      authorEmail: 'alice@example.com',
      message: loadMsg('signed-ok.txt'),
      parentCount: 1,
    });
    assert.equal(signed.ok, true);

    const unsigned = checkCommitDco({
      hash: 'bb22',
      authorEmail: 'alice@example.com',
      message: loadMsg('unsigned.txt'),
      parentCount: 1,
    });
    assert.equal(unsigned.ok, false);
    assert.equal(unsigned.code, 'DCO_MISSING');
    assert.match(formatDcoResult(checkCommitsDco([unsigned])), /dco-check: FAIL/);

    // 3) Approval missing → refused (no registry write)
    const registry = path.join(tmpRoot, 'reg-dry-run');
    fs.rmSync(registry, { recursive: true, force: true });
    const noApproval = publishExternalContribution({
      registryRoot: registry,
      sourceDir: goodDir,
      actor: 'maintainer:dry',
      approvalRef: '  ',
    });
    assert.equal(noApproval.ok, false);
    assert.equal(noApproval.code, 'APPROVAL_REQUIRED');
    assert.equal(fs.existsSync(path.join(registry, 'skills')), false);

    // 4) Approval present → published to temp registry with tag ref
    const digest = readDigest(goodDir);
    const published = publishExternalContribution({
      registryRoot: registry,
      sourceDir: goodDir,
      actor: 'maintainer:dry',
      approvalRef: 'PR#dry-run',
      expectedDigest: digest,
    });
    assert.equal(published.ok, true, JSON.stringify(published));
    assert.equal(published.tag, 'skill/contrib-external-example/v1.0.0');
    assert.ok(fs.existsSync(path.join(registry, 'skills', 'contrib-external-example', '1.0.0', 'manifest.json')));
  });
});
