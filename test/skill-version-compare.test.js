'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compareScorecards } = require('../scripts/bench/compare.cjs');
const {
  compareSkillVersions,
  assertPublishCompareGate,
} = require('../scripts/lib/skills/skill-version-compare.cjs');
const { publishSkill } = require('../scripts/lib/skills/skill-registry.cjs');
const { digestSkillBody } = require('../scripts/lib/skills/skill-integrity.cjs');
const { buildApprovedPublishReview } = require('../scripts/lib/skills/skill-publish-review.cjs');

const pluginRoot = path.resolve(__dirname, '..');
const fixtures = path.join(pluginRoot, 'test/fixtures/skill-version-compare');
const v1 = path.join(fixtures, 'v1-scorecard.json');
const v2reg = path.join(fixtures, 'v2-regression-scorecard.json');
const v2imp = path.join(fixtures, 'v2-improve-scorecard.json');
const tmpRoot = path.join(__dirname, '_tmp-skill-version-compare');

const MEMORY = Object.freeze({ publicSafe: true, declaration: 'first-party' });

function writePackage(dir, name, version) {
  fs.mkdirSync(dir, { recursive: true });
  const skillMd = `---
name: ${name}
description: "AE-033a fixture"
metadata:
  version: "${version}"
  eval_status: "unevaluated"
  eval_ref: ""
---
# ${name} ${version}
`;
  const digest = digestSkillBody(skillMd);
  const manifest = {
    name,
    version,
    description: 'AE-033a fixture',
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
  fs.writeFileSync(
    path.join(dir, 'publish-review.json'),
    `${JSON.stringify(buildApprovedPublishReview({
      skill: name,
      version,
      digest,
    }), null, 2)}\n`
  );
  return manifest;
}

describe('AE-033a semver compare + regression gate', () => {
  before(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('fixture v2 regression → REGRESSION / non-zero (compare.cjs CLI)', () => {
    const r = compareScorecards(v1, v2reg);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'REGRESSION');
    assert.ok(r.regressions.some((x) => x.kind === 'delivery_regression'));

    const cli = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts/bench/compare.cjs'), '--baseline', v1, '--current', v2reg],
      { encoding: 'utf8' }
    );
    assert.notEqual(cli.status, 0);
    assert.match(cli.stderr, /REGRESSION/);
  });

  it('fixture v2 improvement → attach compare_digest', () => {
    const r = compareSkillVersions({
      baselinePath: v1,
      currentPath: v2imp,
      skill: 'demo',
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
    });
    assert.equal(r.ok, true);
    assert.equal(r.exitCode, 0);
    assert.match(r.compare_digest, /^[a-f0-9]{64}$/);

    const cli = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts/bench/compare.cjs'), '--baseline', v1, '--current', v2imp],
      { encoding: 'utf8' }
    );
    assert.equal(cli.status, 0);
    assert.match(cli.stdout, /compare_digest: [a-f0-9]{64}/);
  });

  it('publishSkill blocked on compare REGRESSION (semver candidate workflow)', () => {
    const registry = path.join(tmpRoot, 'reg-reg');
    const src = path.join(tmpRoot, 'src-reg');
    writePackage(src, 'cmpgate', '2.0.0');
    const blocked = publishSkill({
      registryRoot: registry,
      sourceDir: src,
      actor: 'maintainer:test',
      memorySource: MEMORY,
      compareBaseline: v1,
      compareCurrent: v2reg,
      compareFromVersion: '1.0.0',
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'REGRESSION');
    assert.equal(fs.existsSync(path.join(registry, 'skills')), false);
  });

  it('publishSkill succeeds on improvement and returns compare_digest', () => {
    const registry = path.join(tmpRoot, 'reg-ok');
    const src = path.join(tmpRoot, 'src-ok');
    writePackage(src, 'cmpok', '2.0.0');
    const ok = publishSkill({
      registryRoot: registry,
      sourceDir: src,
      actor: 'maintainer:test',
      memorySource: MEMORY,
      compareBaseline: v1,
      compareCurrent: v2imp,
      compareFromVersion: '1.0.0',
    });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.match(ok.compare_digest, /^[a-f0-9]{64}$/);
  });

  it('assertPublishCompareGate incomplete pair fails closed', () => {
    const r = assertPublishCompareGate({ compareBaseline: v1 });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'COMPARE_INCOMPLETE');
  });
});
