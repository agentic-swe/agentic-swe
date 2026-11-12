'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  installSkill,
  publishSkill,
  deprecateSkill,
  revokeSkill,
  resolve,
  readIndex,
  readRevocation,
  readRegistryLog,
  resolveAndVerify,
  gitTagRef,
  INDEX_NAME,
  REVOCATION_NAME,
  REGISTRY_LOG_NAME,
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

describe('AE-025b version immutability, deprecation, revocation', () => {
  const lifeRoot = path.join(__dirname, '_tmp-skill-registry-lifecycle');

  before(() => {
    fs.rmSync(lifeRoot, { recursive: true, force: true });
    fs.mkdirSync(lifeRoot, { recursive: true });
  });
  after(() => {
    fs.rmSync(lifeRoot, { recursive: true, force: true });
  });

  it('re-publishing same version with different digest fails VERSION_IMMUTABLE; same digest is idempotent', () => {
    const registry = path.join(lifeRoot, 'reg-immutable');
    const src = path.join(lifeRoot, 'src-immutable');
    writePackage(src, baseManifest('immut', '1.0.0'), '# v1 body\n');
    const pub = publishSkill({ registryRoot: registry, sourceDir: src, actor: 'maintainer:test' });
    assert.equal(pub.ok, true);
    assert.equal(pub.tag, 'skill/immut/v1.0.0');
    assert.equal(gitTagRef('immut', '1.0.0'), 'skill/immut/v1.0.0');

    // Same content republish ok
    const again = publishSkill({ registryRoot: registry, sourceDir: src, actor: 'maintainer:test' });
    assert.equal(again.ok, true);

    writePackage(src, baseManifest('immut', '1.0.0'), '# different body\n');
    const drift = publishSkill({ registryRoot: registry, sourceDir: src, actor: 'maintainer:test' });
    assert.equal(drift.ok, false);
    assert.equal(drift.code, 'VERSION_IMMUTABLE');

    // Update = new version
    writePackage(src, baseManifest('immut', '1.1.0'), '# v1.1 body\n');
    const updated = publishSkill({ registryRoot: registry, sourceDir: src, actor: 'maintainer:test' });
    assert.equal(updated.ok, true);
    assert.equal(updated.manifest.version, '1.1.0');
  });

  it('deprecated version resolves with warning; revoked cannot be newly installed (REVOKED)', () => {
    const registry = path.join(lifeRoot, 'reg-depr');
    const src = path.join(lifeRoot, 'src-depr');
    writePackage(src, baseManifest('lifecycle', '2.0.0'));
    assert.equal(publishSkill({ registryRoot: registry, sourceDir: src, actor: 'actor:a' }).ok, true);

    const dep = deprecateSkill({
      registryRoot: registry,
      name: 'lifecycle',
      version: '2.0.0',
      actor: 'actor:a',
      reason: 'use 2.1+',
    });
    assert.equal(dep.ok, true);
    assert.equal(dep.status, 'deprecated');

    const index = readIndex(path.join(registry, INDEX_NAME));
    const hit = resolve('lifecycle', '*', index);
    assert.equal(hit.ok, true);
    assert.equal(hit.status, 'deprecated');
    assert.equal(hit.warning.code, 'DEPRECATED');
    assert.equal(hit.warning.version, '2.0.0');

    const rev = revokeSkill({
      registryRoot: registry,
      name: 'lifecycle',
      version: '2.0.0',
      actor: 'actor:a',
      reason: 'security',
    });
    assert.equal(rev.ok, true);
    assert.equal(rev.status, 'revoked');
    assert.match(rev.already_installed, /retained/);
    // Already-installed files remain
    assert.ok(fs.existsSync(path.join(registry, 'skills', 'lifecycle', '2.0.0', 'SKILL.md')));

    const afterRevoke = resolve('lifecycle', '*', index);
    // stale index object — re-read
    const index2 = readIndex(path.join(registry, INDEX_NAME));
    const revocation = readRevocation(path.join(registry, REVOCATION_NAME));
    assert.equal(resolve('lifecycle', '*', index2, { revocation }).ok, false);
    assert.equal(resolve('lifecycle', '*', index2, { revocation }).code, 'NO_SATISFYING_VERSION');

    // New install of revoked version blocked
    const reinstall = installSkill({ registryRoot: registry, sourceDir: src });
    assert.equal(reinstall.ok, false);
    assert.equal(reinstall.code, 'REVOKED');

    const republish = publishSkill({ registryRoot: registry, sourceDir: src, actor: 'actor:a' });
    assert.equal(republish.ok, false);
    assert.equal(republish.code, 'REVOKED');
  });

  it('dependency resolver will not newly select a revoked version', () => {
    const registry = path.join(lifeRoot, 'reg-dep-rev');
    const srcLib = path.join(lifeRoot, 'src-lib');
    writePackage(srcLib, baseManifest('lib-x', '1.0.0'));
    assert.equal(publishSkill({ registryRoot: registry, sourceDir: srcLib, actor: 'actor:b' }).ok, true);
    assert.equal(
      revokeSkill({ registryRoot: registry, name: 'lib-x', version: '1.0.0', actor: 'actor:b' }).ok,
      true
    );

    const srcApp = path.join(lifeRoot, 'src-app');
    writePackage(
      srcApp,
      baseManifest('app-x', '1.0.0', {
        dependencies: [{ name: 'lib-x', range: '^1.0.0' }],
      })
    );
    const blocked = installSkill({ registryRoot: registry, sourceDir: srcApp });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'DEP_INVALID');
    assert.equal(fs.existsSync(path.join(registry, 'skills', 'app-x')), false);

    // Publish a non-revoked lib version; dep should then resolve
    writePackage(srcLib, baseManifest('lib-x', '1.1.0'), '# lib 1.1\n');
    assert.equal(publishSkill({ registryRoot: registry, sourceDir: srcLib, actor: 'actor:b' }).ok, true);
    const ok = installSkill({ registryRoot: registry, sourceDir: srcApp });
    assert.equal(ok.ok, true);
  });

  it('audit/registry log records publish/deprecate/revoke with actor; no blank actor', () => {
    const registry = path.join(lifeRoot, 'reg-audit');
    const src = path.join(lifeRoot, 'src-audit');
    writePackage(src, baseManifest('audited', '1.0.0'));

    const noActor = publishSkill({ registryRoot: registry, sourceDir: src, actor: '   ' });
    assert.equal(noActor.ok, false);
    assert.equal(noActor.code, 'ACTOR_REQUIRED');
    assert.equal(fs.existsSync(path.join(registry, REGISTRY_LOG_NAME)), false);

    assert.equal(publishSkill({ registryRoot: registry, sourceDir: src, actor: 'founder' }).ok, true);
    assert.equal(
      deprecateSkill({
        registryRoot: registry,
        name: 'audited',
        version: '1.0.0',
        actor: 'founder',
        reason: 'sunset',
      }).ok,
      true
    );
    assert.equal(
      revokeSkill({
        registryRoot: registry,
        name: 'audited',
        version: '1.0.0',
        actor: 'founder',
        reason: 'cve',
      }).ok,
      true
    );

    const log = readRegistryLog(registry);
    const actions = log.map((e) => e.action);
    assert.deepEqual(actions, ['publish', 'deprecate', 'revoke']);
    for (const e of log) {
      assert.equal(e.actor, 'founder');
      assert.equal(e.name, 'audited');
      assert.equal(e.version, '1.0.0');
      assert.ok(e.ts);
    }
  });

  it('blank/whitespace name or version on deprecate/revoke is NOT_FOUND; corrupt revocation fails closed', () => {
    const registry = path.join(lifeRoot, 'reg-gate-b');
    const src = path.join(lifeRoot, 'src-gate-b');
    writePackage(src, baseManifest('gateb', '1.0.0'));
    assert.equal(publishSkill({ registryRoot: registry, sourceDir: src, actor: 'a' }).ok, true);

    assert.equal(deprecateSkill({ registryRoot: registry, name: '', version: '1.0.0', actor: 'a' }).code, 'NOT_FOUND');
    assert.equal(deprecateSkill({ registryRoot: registry, name: 'gateb', version: '  ', actor: 'a' }).code, 'NOT_FOUND');
    assert.equal(revokeSkill({ registryRoot: registry, name: null, version: '1.0.0', actor: 'a' }).code, 'NOT_FOUND');
    assert.equal(deprecateSkill({ registryRoot: registry, name: 'gateb', version: '1.0.0', actor: '' }).code, 'ACTOR_REQUIRED');

    fs.writeFileSync(path.join(registry, REVOCATION_NAME), '{bad');
    const src2 = path.join(lifeRoot, 'src-gate-b2');
    writePackage(src2, baseManifest('gateb2', '1.0.0'));
    const badRev = installSkill({ registryRoot: registry, sourceDir: src2 });
    assert.equal(badRev.ok, false);
    assert.equal(badRev.code, 'REVOCATION_INVALID');
    assert.equal(fs.existsSync(path.join(registry, 'skills', 'gateb2')), false);
  });

  it('gitTagRef rejects blank name/version; leading v is normalized', () => {
    assert.equal(gitTagRef('x', '2.0.0'), 'skill/x/v2.0.0');
    assert.equal(gitTagRef('x', 'v2.0.0'), 'skill/x/v2.0.0');
    assert.throws(() => gitTagRef('', '1.0.0'), (e) => e.code === 'TAG_REF_INVALID');
    assert.throws(() => gitTagRef('x', '  '), (e) => e.code === 'TAG_REF_INVALID');
  });
});
