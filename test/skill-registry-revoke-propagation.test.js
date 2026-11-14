'use strict';

/**
 * AE-037c — revocation propagates to shared installs (ADR-017 A4 / M5-E4).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  publishSkill,
  revokeSkill,
  resolve,
  installSkill,
  registerSharedInstall,
  resolveSharedInstall,
  readIndex,
  readRevocation,
  readRegistryLog,
  readSharedInstalls,
  INDEX_NAME,
  REVOCATION_NAME,
  SHARED_INSTALLS_NAME,
  STATUS_REVOKED,
} = require('../scripts/lib/skills/skill-registry.cjs');
const { digestSkillBody } = require('../scripts/lib/skills/skill-integrity.cjs');
const { buildApprovedPublishReview } = require('../scripts/lib/skills/skill-publish-review.cjs');

const tmpRoot = path.join(__dirname, '_tmp-skill-registry-revoke-prop');

const FIRST_PARTY_MEMORY_SOURCE = Object.freeze({
  publicSafe: true,
  declaration: 'first-party',
});

function publishFirstParty(opts) {
  return publishSkill({ ...opts, memorySource: FIRST_PARTY_MEMORY_SOURCE });
}

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
  fs.writeFileSync(
    path.join(dir, 'publish-review.json'),
    `${JSON.stringify(
      buildApprovedPublishReview({
        skill: m.name,
        version: m.version,
        digest: m.digest,
        reviewer: 'test-independent-reviewer',
      }),
      null,
      2
    )}\n`
  );
  return m;
}

function baseManifest(name, version, extra = {}) {
  return {
    name,
    version,
    description: `Revoke fixture ${name}`,
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

describe('AE-037c revocation propagation', () => {
  before(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('AE-037c_revoke_propagates_to_shared_installs_resolve_install_fail_closed', () => {
    const registry = path.join(tmpRoot, 'reg-shared-revoke');
    const srcShared = path.join(tmpRoot, 'src-shared-org');
    writePackage(srcShared, baseManifest('shared-org-skill', '1.2.0'));

    const pub = publishFirstParty({
      registryRoot: registry,
      sourceDir: srcShared,
      actor: 'ae037c-tester',
      visibility: 'organization',
      tenant_id: 'pilot-t1',
      org_id: 'org-a',
    });
    assert.equal(pub.ok, true, (pub.errors || []).join(';'));

    const a = registerSharedInstall({
      registryRoot: registry,
      name: 'shared-org-skill',
      version: '1.2.0',
      install_id: 'site-a',
      tenant_id: 'pilot-t1',
    });
    const b = registerSharedInstall({
      registryRoot: registry,
      name: 'shared-org-skill',
      version: '1.2.0',
      install_id: 'site-b',
      tenant_id: 'pilot-t1',
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);

    assert.equal(
      resolveSharedInstall({ registryRoot: registry, install_id: 'site-a' }).ok,
      true
    );

    const rev = revokeSkill({
      registryRoot: registry,
      name: 'shared-org-skill',
      version: '1.2.0',
      actor: 'ae037c-revoker',
      reason: 'pilot revoke',
    });
    assert.equal(rev.ok, true);
    assert.equal(rev.status, STATUS_REVOKED);
    assert.equal(rev.shared_installs_revoked, 2);

    const shared = readSharedInstalls(path.join(registry, SHARED_INSTALLS_NAME));
    const sites = shared.installs.filter((i) => i.name === 'shared-org-skill');
    assert.equal(sites.length, 2);
    assert.ok(sites.every((i) => i.status === STATUS_REVOKED));

    // Shared installs see revoked (fail closed).
    assert.equal(
      resolveSharedInstall({ registryRoot: registry, install_id: 'site-a' }).code,
      'REVOKED'
    );
    assert.equal(
      resolveSharedInstall({ registryRoot: registry, install_id: 'site-b' }).code,
      'REVOKED'
    );

    // Direct resolve/install also fail closed (revoked versions excluded from resolve).
    const index = readIndex(path.join(registry, INDEX_NAME));
    const resolved = resolve('shared-org-skill', '1.2.0', index, {
      tenant_id: 'pilot-t1',
      org_id: 'org-a',
      revocation: readRevocation(path.join(registry, REVOCATION_NAME)),
    });
    assert.equal(resolved.ok, false);
    assert.ok(
      resolved.code === 'NO_SATISFYING_VERSION' || resolved.code === 'REVOKED',
      `unexpected resolve code ${resolved.code}`
    );
    const revocation = readRevocation(path.join(registry, REVOCATION_NAME));
    assert.ok(
      revocation.entries.some(
        (e) => e.name === 'shared-org-skill' && e.version === '1.2.0'
      )
    );

    const reinstall = installSkill({
      registryRoot: registry,
      sourceDir: srcShared,
      visibility: 'organization',
      tenant_id: 'pilot-t1',
      org_id: 'org-a',
    });
    assert.equal(reinstall.ok, false);
    assert.equal(reinstall.code, 'REVOKED');

    // Cannot register new shared install after revoke.
    assert.equal(
      registerSharedInstall({
        registryRoot: registry,
        name: 'shared-org-skill',
        version: '1.2.0',
        install_id: 'site-c',
        tenant_id: 'pilot-t1',
      }).code,
      'REVOKED'
    );
  });

  it('AE-037c_audit_and_revocation_record_exist_after_revoke', () => {
    const registry = path.join(tmpRoot, 'reg-audit-revoke');
    const src = path.join(tmpRoot, 'src-audit-priv');
    writePackage(src, baseManifest('audit-private', '3.0.0'));
    assert.equal(
      publishFirstParty({
        registryRoot: registry,
        sourceDir: src,
        actor: 'ae037c-tester',
        visibility: 'private',
        tenant_id: 'pilot-t1',
        owner_id: 'user-1',
      }).ok,
      true
    );
    assert.equal(
      registerSharedInstall({
        registryRoot: registry,
        name: 'audit-private',
        version: '3.0.0',
        install_id: 'desk-1',
        tenant_id: 'pilot-t1',
      }).ok,
      true
    );

    const rev = revokeSkill({
      registryRoot: registry,
      name: 'audit-private',
      version: '3.0.0',
      actor: 'ae037c-revoker',
      reason: 'leak containment',
    });
    assert.equal(rev.ok, true);
    assert.equal(rev.shared_installs_revoked, 1);

    const revocation = readRevocation(path.join(registry, REVOCATION_NAME));
    const entry = revocation.entries.find(
      (e) => e.name === 'audit-private' && e.version === '3.0.0'
    );
    assert.ok(entry);
    assert.equal(entry.revoked_by, 'ae037c-revoker');
    assert.equal(entry.reason, 'leak containment');

    const log = readRegistryLog(registry);
    const revokeEvents = log.filter(
      (e) => e.action === 'revoke' && e.name === 'audit-private' && e.version === '3.0.0'
    );
    assert.equal(revokeEvents.length, 1);
    assert.equal(revokeEvents[0].actor, 'ae037c-revoker');
    assert.equal(revokeEvents[0].shared_installs_revoked, 1);
    assert.equal(revokeEvents[0].reason, 'leak containment');
  });

  it('AE-037c_unrelated_public_semver_still_resolves_after_revoke', () => {
    const registry = path.join(tmpRoot, 'reg-unrelated-public');
    const srcShared = path.join(tmpRoot, 'src-revoked-team');
    const srcPublic = path.join(tmpRoot, 'src-keep-public');
    writePackage(srcShared, baseManifest('team-tool', '1.0.0'));
    writePackage(srcPublic, baseManifest('public-tool', '2.3.1'));

    assert.equal(
      publishFirstParty({
        registryRoot: registry,
        sourceDir: srcShared,
        actor: 'ae037c-tester',
        visibility: 'team',
        tenant_id: 'pilot-t1',
        org_id: 'org-a',
        team_id: 'team-x',
      }).ok,
      true
    );
    assert.equal(
      publishFirstParty({
        registryRoot: registry,
        sourceDir: srcPublic,
        actor: 'ae037c-tester',
        visibility: 'public',
      }).ok,
      true
    );
    assert.equal(
      registerSharedInstall({
        registryRoot: registry,
        name: 'team-tool',
        version: '1.0.0',
        install_id: 'squad-1',
        tenant_id: 'pilot-t1',
      }).ok,
      true
    );

    assert.equal(
      revokeSkill({
        registryRoot: registry,
        name: 'team-tool',
        version: '1.0.0',
        actor: 'ae037c-revoker',
      }).ok,
      true
    );

    const index = readIndex(path.join(registry, INDEX_NAME));
    const hit = resolve('public-tool', '^2.0.0', index);
    assert.equal(hit.ok, true);
    assert.equal(hit.version, '2.3.1');
    assert.equal(hit.visibility, 'public');
  });
});
