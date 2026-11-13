'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  diffPermissions,
  assertPublishPermissionsGate,
} = require('../scripts/lib/skills/skill-permissions-diff.cjs');
const {
  publishSkill,
  resolve,
  readIndex,
  INDEX_NAME,
} = require('../scripts/lib/skills/skill-registry.cjs');
const { digestSkillBody } = require('../scripts/lib/skills/skill-integrity.cjs');
const { buildApprovedPublishReview } = require('../scripts/lib/skills/skill-publish-review.cjs');

const tmpRoot = path.join(__dirname, '_tmp-skill-permissions-diff');
const MEMORY = Object.freeze({ publicSafe: true, declaration: 'first-party' });

function writePackage(dir, name, version, permissions) {
  fs.mkdirSync(dir, { recursive: true });
  const skillMd = `---
name: ${name}
description: "AE-033b fixture"
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
    description: 'AE-033b fixture',
    kind: 'prompt',
    inputs: [],
    outputs: [],
    dependencies: [],
    permissions: Array.isArray(permissions) ? permissions : [],
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

describe('AE-033b permission diff gate', () => {
  before(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('diffPermissions detects strict supersets and expansions', () => {
    const d = diffPermissions([], ['fs.write']);
    assert.deepEqual(d.expanded, ['fs.write']);
    assert.equal(d.is_strict_superset, true);

    const same = diffPermissions(['fs.read'], ['fs.read']);
    assert.equal(same.expanded.length, 0);

    const swap = diffPermissions(['fs.read'], ['fs.write']);
    assert.deepEqual(swap.expanded, ['fs.write']);
    assert.deepEqual(swap.removed, ['fs.read']);
    assert.equal(swap.is_strict_superset, false);
  });

  it('added fs.write without approval → publish fails PERMISSIONS_EXPANDED; prior semver resolvable', () => {
    const registry = path.join(tmpRoot, 'reg-expand');
    const v1 = path.join(tmpRoot, 'src-v1');
    const v2 = path.join(tmpRoot, 'src-v2');
    writePackage(v1, 'permgate', '1.0.0', []);
    const first = publishSkill({
      registryRoot: registry,
      sourceDir: v1,
      actor: 'maintainer:test',
      memorySource: MEMORY,
    });
    assert.equal(first.ok, true, JSON.stringify(first));

    writePackage(v2, 'permgate', '2.0.0', ['fs.write']);
    const blocked = publishSkill({
      registryRoot: registry,
      sourceDir: v2,
      actor: 'maintainer:test',
      memorySource: MEMORY,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'PERMISSIONS_EXPANDED');
    assert.ok((blocked.expanded || []).includes('fs.write'));
    assert.equal(fs.existsSync(path.join(registry, 'skills', 'permgate', '2.0.0')), false);

    const index = readIndex(path.join(registry, INDEX_NAME));
    const resolved = resolve('permgate', '1.0.0', index);
    assert.equal(resolved.ok, true);
    assert.equal(resolved.version, '1.0.0');
  });

  it('same permissions allow publish of next semver', () => {
    const registry = path.join(tmpRoot, 'reg-same');
    const v1 = path.join(tmpRoot, 'src-same-v1');
    const v2 = path.join(tmpRoot, 'src-same-v2');
    writePackage(v1, 'permsame', '1.0.0', ['fs.read']);
    assert.equal(
      publishSkill({
        registryRoot: registry,
        sourceDir: v1,
        actor: 'maintainer:test',
        memorySource: MEMORY,
      }).ok,
      true
    );
    writePackage(v2, 'permsame', '1.1.0', ['fs.read']);
    const ok = publishSkill({
      registryRoot: registry,
      sourceDir: v2,
      actor: 'maintainer:test',
      memorySource: MEMORY,
    });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    const index = readIndex(path.join(registry, INDEX_NAME));
    assert.equal(resolve('permsame', '1.0.0', index).ok, true);
    assert.equal(resolve('permsame', '1.1.0', index).ok, true);
  });

  it('assertPublishPermissionsGate with explicit baseline rejects expansion', () => {
    const src = path.join(tmpRoot, 'src-explicit');
    writePackage(src, 'explicit', '2.0.0', ['fs.write']);
    const r = assertPublishPermissionsGate({
      sourceDir: src,
      baselinePermissions: [],
      compareFromVersion: '1.0.0',
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PERMISSIONS_EXPANDED');
  });
});
