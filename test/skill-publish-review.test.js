'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  publishSkill,
  readRegistryLog,
} = require('../scripts/lib/skills/skill-registry.cjs');
const { digestSkillBody } = require('../scripts/lib/skills/skill-integrity.cjs');
const {
  buildApprovedPublishReview,
  validatePublishReview,
  requirePublishReview,
} = require('../scripts/lib/skills/skill-publish-review.cjs');
const { writeCandidatePackage } = require('../scripts/lib/skills/candidate-package.cjs');

const tmpRoot = path.join(__dirname, '_tmp-skill-publish-review');

const FIRST_PARTY_MEMORY_SOURCE = Object.freeze({
  publicSafe: true,
  declaration: 'first-party',
});

function writePackage(dir, name, version, body = '# body\n') {
  fs.mkdirSync(dir, { recursive: true });
  const skillMd = `---
name: ${name}
description: "AE-032c fixture ${name}"
metadata:
  version: "${version}"
  eval_status: "unevaluated"
  eval_ref: ""
---
${body}`;
  const digest = digestSkillBody(skillMd);
  const manifest = {
    name,
    version,
    description: `AE-032c fixture ${name}`,
    kind: 'prompt',
    inputs: [],
    outputs: [],
    dependencies: [],
    permissions: [],
    runtime: { node: '>=22.0.0' },
    compatibility: { pack: '^3.0.0' },
    validation: { rules: ['schema'] },
    provenance: { origin: 'first-party', authors: ['test'] },
    maintainer: 'test',
    digest,
  };
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

describe('AE-032c publish review artifact + publishSkill bridge', () => {
  before(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('validatePublishReview enforces FD-B checklist (no auto-merge)', () => {
    const base = buildApprovedPublishReview({
      skill: 'demo',
      version: '1.0.0',
      digest: 'a'.repeat(64),
    });
    assert.equal(validatePublishReview(base).ok, true);

    const auto = structuredClone(base);
    auto.fd_b.auto_merge = true;
    const badAuto = validatePublishReview(auto);
    assert.equal(badAuto.ok, false);
    assert.equal(badAuto.code, 'REVIEW_INVALID');
    assert.ok(badAuto.errors.some((e) => /auto_merge/.test(e)));

    const missing = structuredClone(base);
    delete missing.fd_b.ruleset_unchanged;
    assert.equal(validatePublishReview(missing).ok, false);

    const rejected = structuredClone(base);
    rejected.verdict = 'rejected';
    assert.equal(validatePublishReview(rejected).code, 'REVIEW_REJECTED');
  });

  it('publishSkill without review artifact fails REVIEW_REQUIRED', () => {
    const registry = path.join(tmpRoot, 'reg-noreview');
    const src = path.join(tmpRoot, 'src-noreview');
    writePackage(src, 'noreview', '1.0.0');
    // Explicitly omit sidecar and reviewArtifact.
    const r = publishSkill({
      registryRoot: registry,
      sourceDir: src,
      actor: 'maintainer:test',
      memorySource: FIRST_PARTY_MEMORY_SOURCE,
      reviewArtifact: null,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'REVIEW_REQUIRED');
    assert.equal(fs.existsSync(path.join(registry, 'skills')), false);
  });

  it('publishSkill with review artifact + actor succeeds in fixture', () => {
    const registry = path.join(tmpRoot, 'reg-ok');
    const src = path.join(tmpRoot, 'src-ok');
    const m = writePackage(src, 'reviewed', '1.0.0');
    const review = buildApprovedPublishReview({
      skill: m.name,
      version: m.version,
      digest: m.digest,
      reviewer: 'security-reviewer',
    });
    const r = publishSkill({
      registryRoot: registry,
      sourceDir: src,
      actor: 'maintainer:test',
      memorySource: FIRST_PARTY_MEMORY_SOURCE,
      reviewArtifact: review,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.actor, 'maintainer:test');
    assert.ok(r.review);
    assert.equal(r.review.verdict, 'approved');
    assert.equal(r.review.fd_b.auto_merge, false);
    const log = readRegistryLog(registry);
    const last = log[log.length - 1];
    assert.equal(last.action, 'publish');
    assert.equal(last.reviewer, 'security-reviewer');
    assert.equal(last.review_verdict, 'approved');
  });

  it('publishSkill accepts publish-review.json sidecar', () => {
    const registry = path.join(tmpRoot, 'reg-sidecar');
    const src = path.join(tmpRoot, 'src-sidecar');
    const m = writePackage(src, 'sidecar', '1.0.0');
    fs.writeFileSync(
      path.join(src, 'publish-review.json'),
      `${JSON.stringify(buildApprovedPublishReview({
        skill: m.name,
        version: m.version,
        digest: m.digest,
      }), null, 2)}\n`
    );
    const r = publishSkill({
      registryRoot: registry,
      sourceDir: src,
      actor: 'founder',
      memorySource: FIRST_PARTY_MEMORY_SOURCE,
    });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it('candidate package can be published only after review artifact (bridge)', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-032c-cand-'));
    const packaged = writeCandidatePackage({
      projectRoot,
      candidate: {
        skill: 'candbridge',
        kind: 'npm_run',
        verify_command: 'npm run candbridge',
        autonomous_selection: false,
      },
      validate: true,
      runTests: true,
    });
    assert.equal(packaged.ok, true, JSON.stringify(packaged.errors));

    const registry = path.join(tmpRoot, 'reg-cand');
    const without = publishSkill({
      registryRoot: registry,
      sourceDir: packaged.path,
      actor: 'maintainer:test',
      memorySource: FIRST_PARTY_MEMORY_SOURCE,
      reviewArtifact: null,
    });
    assert.equal(without.ok, false);
    assert.equal(without.code, 'REVIEW_REQUIRED');

    const manifest = JSON.parse(fs.readFileSync(path.join(packaged.path, 'manifest.json'), 'utf8'));
    const withReview = publishSkill({
      registryRoot: registry,
      sourceDir: packaged.path,
      actor: 'maintainer:test',
      memorySource: FIRST_PARTY_MEMORY_SOURCE,
      reviewArtifact: buildApprovedPublishReview({
        skill: manifest.name,
        version: manifest.version,
        digest: manifest.digest,
      }),
    });
    assert.equal(withReview.ok, true, JSON.stringify(withReview));
  });

  it('requirePublishReview mismatches skill/digest fail closed', () => {
    const review = buildApprovedPublishReview({
      skill: 'a',
      version: '1.0.0',
      digest: 'b'.repeat(64),
    });
    const r = requirePublishReview({
      reviewArtifact: review,
      skill: 'a',
      version: '1.0.0',
      digest: 'c'.repeat(64),
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'REVIEW_INVALID');
  });
});
