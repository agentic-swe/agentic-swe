'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  installSkill,
  resolve,
  readIndex,
  resolveAndVerify,
  INDEX_NAME,
} = require('../scripts/lib/skills/skill-registry.cjs');
const { digestSkillBody, LOCKFILE_NAME } = require('../scripts/lib/skills/skill-integrity.cjs');

const tmpRoot = path.join(__dirname, '_tmp-skill-registry');

function writePackage(dir, manifest, body = '# body\n') {
  fs.mkdirSync(dir, { recursive: true });
  const skillMd = `---
name: ${manifest.name}
description: "${manifest.description}"
metadata:
  version: "${manifest.version}"
  eval_status: "unevaluated"
  eval_ref: ""
---
${body}`;
  const digest = digestSkillBody(skillMd);
  const m = { ...manifest, digest };
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2));
  return m;
}

function baseManifest(name, version, extra = {}) {
  return {
    name,
    version,
    description: `Registry fixture ${name}`,
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
    ...extra,
  };
}

describe('AE-025a local skill registry', () => {
  before(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('resolve returns manifest or NOT_FOUND / NO_SATISFYING_VERSION', () => {
    const registry = path.join(tmpRoot, 'reg-resolve');
    const src = path.join(tmpRoot, 'src-a');
    writePackage(src, baseManifest('alpha', '1.2.0'));
    assert.equal(installSkill({ registryRoot: registry, sourceDir: src }).ok, true);

    const index = readIndex(path.join(registry, INDEX_NAME));
    const hit = resolve('alpha', '^1.0.0', index);
    assert.equal(hit.ok, true);
    assert.equal(hit.version, '1.2.0');

    assert.equal(resolve('missing', '*', index).code, 'NOT_FOUND');
    assert.equal(resolve('alpha', '^2.0.0', index).code, 'NO_SATISFYING_VERSION');
  });

  it('atomic install; crash mid-install leaves no half-registered skill', () => {
    const registry = path.join(tmpRoot, 'reg-crash');
    const src = path.join(tmpRoot, 'src-crash');
    writePackage(src, baseManifest('crashy', '1.0.0'));
    const crashed = installSkill({ registryRoot: registry, sourceDir: src, crashBeforeActivate: true });
    assert.equal(crashed.ok, false);
    assert.equal(crashed.code, 'INSTALL_CRASHED');
    assert.ok(fs.existsSync(crashed.staging));
    assert.equal(fs.existsSync(path.join(registry, 'skills', 'crashy', '1.0.0')), false);
    assert.equal(fs.existsSync(path.join(registry, INDEX_NAME)), false);
    assert.equal(fs.existsSync(path.join(registry, LOCKFILE_NAME)), false);
    fs.rmSync(crashed.staging, { recursive: true, force: true });

    const ok = installSkill({ registryRoot: registry, sourceDir: src });
    assert.equal(ok.ok, true);
    assert.ok(fs.existsSync(path.join(registry, 'skills', 'crashy', '1.0.0', 'SKILL.md')));
    const verified = resolveAndVerify(registry, 'crashy', '*');
    assert.equal(verified.ok, true);
  });

  it('dependency cycle or missing dep fails with DEP_INVALID; nothing activated', () => {
    const registry = path.join(tmpRoot, 'reg-deps');
    const srcA = path.join(tmpRoot, 'src-dep-a');
    writePackage(
      srcA,
      baseManifest('dep-a', '1.0.0', {
        dependencies: [{ name: 'dep-b', range: '^1.0.0' }],
      })
    );
    const missing = installSkill({ registryRoot: registry, sourceDir: srcA });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'DEP_INVALID');
    assert.equal(fs.existsSync(path.join(registry, 'skills', 'dep-a')), false);

    const srcB = path.join(tmpRoot, 'src-dep-b');
    writePackage(
      srcB,
      baseManifest('dep-b', '1.0.0', {
        dependencies: [{ name: 'dep-a', range: '^1.0.0' }],
      })
    );
    // Install B first (no deps satisfied for A yet) — B depends on A which is missing
    const bMissing = installSkill({ registryRoot: registry, sourceDir: srcB });
    assert.equal(bMissing.ok, false);
    assert.equal(bMissing.code, 'DEP_INVALID');
  });

  it('refuses install scripts and network without injected transport; digest verify', () => {
    const registry = path.join(tmpRoot, 'reg-supply');
    const src = path.join(tmpRoot, 'src-scripts');
    const m = writePackage(src, baseManifest('scripty', '1.0.0'));
    fs.writeFileSync(path.join(src, 'postinstall.js'), 'console.log(1)');
    const banned = installSkill({ registryRoot: registry, sourceDir: src });
    assert.equal(banned.ok, false);
    assert.equal(banned.code, 'INSTALL_SCRIPTS_FORBIDDEN');

    fs.rmSync(path.join(src, 'postinstall.js'));
    const net = installSkill({ registryRoot: registry, sourceDir: src, requireNetwork: true });
    assert.equal(net.ok, false);
    assert.equal(net.code, 'NETWORK_DENIED');

    // Tamper digest in manifest
    const bad = { ...m, digest: 'b'.repeat(64) };
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify(bad, null, 2));
    const mismatch = installSkill({ registryRoot: registry, sourceDir: src });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'DIGEST_MISMATCH');

    writePackage(src, baseManifest('scripty', '1.0.0'));
    const ok = installSkill({
      registryRoot: registry,
      sourceDir: src,
      transport: { fetch: async () => ({ ok: true }) },
      requireNetwork: true,
    });
    assert.equal(ok.ok, true);
  });

  it('blank/whitespace name is NOT_FOUND; corrupt lock fails closed; digest drift is VERSION_IMMUTABLE', () => {
    const registry = path.join(tmpRoot, 'reg-gates');
    const src = path.join(tmpRoot, 'src-gates');
    const m = writePackage(src, baseManifest('gated', '1.0.0'));
    assert.equal(installSkill({ registryRoot: registry, sourceDir: src }).ok, true);

    const index = readIndex(path.join(registry, INDEX_NAME));
    assert.equal(resolve('', '*', index).code, 'NOT_FOUND');
    assert.equal(resolve('   ', '*', index).code, 'NOT_FOUND');
    assert.equal(resolve(null, '*', index).code, 'NOT_FOUND');

    // Corrupt lock must not be swallowed into a fresh empty lock.
    fs.writeFileSync(path.join(registry, LOCKFILE_NAME), '{not-json');
    const src2 = path.join(tmpRoot, 'src-gates-2');
    writePackage(src2, baseManifest('gated-b', '1.0.0'));
    const badLock = installSkill({ registryRoot: registry, sourceDir: src2 });
    assert.equal(badLock.ok, false);
    assert.equal(badLock.code, 'LOCKFILE_INVALID');
    assert.equal(fs.existsSync(path.join(registry, 'skills', 'gated-b')), false);

    // Restore lock, then attempt same-version body/digest change.
    const { emptyLockfile, lockPin, writeLockfileAtomic } = require('../scripts/lib/skills/skill-integrity.cjs');
    const lock = emptyLockfile();
    lockPin(lock, 'gated', { version: '1.0.0', digest: m.digest });
    writeLockfileAtomic(path.join(registry, LOCKFILE_NAME), lock);

    writePackage(src, baseManifest('gated', '1.0.0'), '# tampered body\n');
    const drift = installSkill({ registryRoot: registry, sourceDir: src });
    assert.equal(drift.ok, false);
    assert.equal(drift.code, 'VERSION_IMMUTABLE');
  });
});
