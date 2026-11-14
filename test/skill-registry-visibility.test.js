'use strict';

/**
 * AE-037a — skill visibility enum + index fields (ADR-017 A4).
 * Named acceptance tests map 1:1 to m5-plan / lane acceptance.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  installSkill,
  publishSkill,
  resolve,
  listRegistrySkills,
  readIndex,
  INDEX_NAME,
  SKILL_VISIBILITY_PUBLIC,
  SKILL_VISIBILITY_ORGANIZATION,
  SKILL_VISIBILITY_TEAM,
  SKILL_VISIBILITY_PRIVATE,
  SKILL_VISIBILITIES,
  normalizeSkillVisibility,
} = require('../scripts/lib/skills/skill-registry.cjs');
const { digestSkillBody } = require('../scripts/lib/skills/skill-integrity.cjs');
const { buildApprovedPublishReview } = require('../scripts/lib/skills/skill-publish-review.cjs');

const tmpRoot = path.join(__dirname, '_tmp-skill-registry-visibility');

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
    description: `Visibility fixture ${name}`,
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

describe('AE-037a skill visibility enum', () => {
  before(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('AE-037a_visibility_enum_round_trip_on_index', () => {
    assert.ok(SKILL_VISIBILITIES.has(SKILL_VISIBILITY_PUBLIC));
    assert.ok(SKILL_VISIBILITIES.has(SKILL_VISIBILITY_ORGANIZATION));
    assert.ok(SKILL_VISIBILITIES.has(SKILL_VISIBILITY_TEAM));
    assert.ok(SKILL_VISIBILITIES.has(SKILL_VISIBILITY_PRIVATE));
    assert.equal(normalizeSkillVisibility('org').visibility, SKILL_VISIBILITY_ORGANIZATION);

    const registry = path.join(tmpRoot, 'reg-roundtrip');
    const cases = [
      {
        name: 'vis-public',
        visibility: SKILL_VISIBILITY_PUBLIC,
        extra: {},
      },
      {
        name: 'vis-org',
        visibility: SKILL_VISIBILITY_ORGANIZATION,
        extra: { tenant_id: 'pilot-t1', org_id: 'org-a' },
      },
      {
        name: 'vis-team',
        visibility: SKILL_VISIBILITY_TEAM,
        extra: { tenant_id: 'pilot-t1', org_id: 'org-a', team_id: 'team-x' },
      },
      {
        name: 'vis-private',
        visibility: SKILL_VISIBILITY_PRIVATE,
        extra: { tenant_id: 'pilot-t1', owner_id: 'user-1' },
      },
    ];

    for (const c of cases) {
      const src = path.join(tmpRoot, `src-${c.name}`);
      writePackage(src, baseManifest(c.name, '1.0.0'));
      const pub = publishFirstParty({
        registryRoot: registry,
        sourceDir: src,
        actor: 'ae037a-tester',
        visibility: c.visibility,
        ...c.extra,
      });
      assert.equal(pub.ok, true, `${c.name} publish: ${pub.code || ''} ${(pub.errors || []).join(';')}`);
      assert.equal(pub.visibility, c.visibility);
    }

    const index = readIndex(path.join(registry, INDEX_NAME));
    assert.equal(index.skills['vis-public'].versions[0].visibility, 'public');
    assert.equal(index.skills['vis-org'].versions[0].visibility, 'organization');
    assert.equal(index.skills['vis-org'].versions[0].tenant_id, 'pilot-t1');
    assert.equal(index.skills['vis-org'].versions[0].org_id, 'org-a');
    assert.equal(index.skills['vis-team'].versions[0].visibility, 'team');
    assert.equal(index.skills['vis-team'].versions[0].team_id, 'team-x');
    assert.equal(index.skills['vis-private'].versions[0].visibility, 'private');
    assert.equal(index.skills['vis-private'].versions[0].owner_id, 'user-1');

    // Authorized resolve round-trip.
    assert.equal(
      resolve('vis-org', '*', index, { tenant_id: 'pilot-t1', org_id: 'org-a' }).ok,
      true
    );
    assert.equal(
      resolve('vis-team', '*', index, {
        tenant_id: 'pilot-t1',
        org_id: 'org-a',
        team_id: 'team-x',
      }).ok,
      true
    );
    assert.equal(
      resolve('vis-private', '*', index, { tenant_id: 'pilot-t1', owner_id: 'user-1' }).ok,
      true
    );
  });

  it('AE-037a_unknown_visibility_fails_closed', () => {
    assert.equal(normalizeSkillVisibility('secret').ok, false);
    assert.equal(normalizeSkillVisibility('secret').code, 'UNKNOWN_VISIBILITY');

    const registry = path.join(tmpRoot, 'reg-unknown');
    const src = path.join(tmpRoot, 'src-unknown');
    writePackage(src, baseManifest('bad-vis', '1.0.0'));
    const pub = publishFirstParty({
      registryRoot: registry,
      sourceDir: src,
      actor: 'ae037a-tester',
      visibility: 'worldwide',
    });
    assert.equal(pub.ok, false);
    assert.equal(pub.code, 'UNKNOWN_VISIBILITY');
    assert.equal(fs.existsSync(path.join(registry, INDEX_NAME)), false);

    const inst = installSkill({
      registryRoot: registry,
      sourceDir: src,
      visibility: 'classified',
    });
    assert.equal(inst.ok, false);
    assert.equal(inst.code, 'UNKNOWN_VISIBILITY');
  });

  it('AE-037a_private_or_org_not_installable_or_listable_as_public', () => {
    const registry = path.join(tmpRoot, 'reg-public-deny');
    const srcPub = path.join(tmpRoot, 'src-pub-ok');
    const srcOrg = path.join(tmpRoot, 'src-org-hidden');
    const srcPriv = path.join(tmpRoot, 'src-priv-hidden');
    writePackage(srcPub, baseManifest('catalog-public', '1.0.0'));
    writePackage(srcOrg, baseManifest('catalog-org', '1.0.0'));
    writePackage(srcPriv, baseManifest('catalog-private', '1.0.0'));

    assert.equal(
      publishFirstParty({
        registryRoot: registry,
        sourceDir: srcPub,
        actor: 'ae037a-tester',
        visibility: 'public',
      }).ok,
      true
    );
    assert.equal(
      publishFirstParty({
        registryRoot: registry,
        sourceDir: srcOrg,
        actor: 'ae037a-tester',
        visibility: 'organization',
        tenant_id: 'pilot-t1',
        org_id: 'org-a',
      }).ok,
      true
    );
    assert.equal(
      publishFirstParty({
        registryRoot: registry,
        sourceDir: srcPriv,
        actor: 'ae037a-tester',
        visibility: 'private',
        tenant_id: 'pilot-t1',
        owner_id: 'user-1',
      }).ok,
      true
    );

    const index = readIndex(path.join(registry, INDEX_NAME));

    // Not installable as public: resolve under public catalog fails closed.
    assert.equal(resolve('catalog-org', '*', index, { catalog: 'public' }).code, 'VISIBILITY_DENIED');
    assert.equal(
      resolve('catalog-private', '*', index, { catalog: 'public' }).code,
      'VISIBILITY_DENIED'
    );
    // Missing tenant_id for non-public also fails closed (no inference).
    assert.equal(resolve('catalog-org', '*', index).code, 'VISIBILITY_DENIED');
    assert.equal(resolve('catalog-private', '*', index).code, 'VISIBILITY_DENIED');

    // Not listable as public.
    const listed = listRegistrySkills(index, { catalog: 'public' });
    assert.equal(listed.ok, true);
    const names = listed.skills.map((s) => s.name);
    assert.deepEqual(names, ['catalog-public']);
    assert.ok(!names.includes('catalog-org'));
    assert.ok(!names.includes('catalog-private'));
  });

  it('AE-037a_existing_public_skills_still_resolve', () => {
    const registry = path.join(tmpRoot, 'reg-legacy-public');
    const src = path.join(tmpRoot, 'src-legacy');
    writePackage(src, baseManifest('legacy-public', '2.1.0'));
    // Omit visibility → defaults public (backward compatible).
    const pub = publishFirstParty({
      registryRoot: registry,
      sourceDir: src,
      actor: 'ae037a-tester',
    });
    assert.equal(pub.ok, true);
    assert.equal(pub.visibility, 'public');

    const index = readIndex(path.join(registry, INDEX_NAME));
    // Legacy entry without visibility field still resolves as public.
    const entry = index.skills['legacy-public'].versions[0];
    assert.equal(entry.visibility, 'public');
    delete entry.visibility;
    const hit = resolve('legacy-public', '^2.0.0', index);
    assert.equal(hit.ok, true);
    assert.equal(hit.version, '2.1.0');
    assert.equal(hit.visibility, 'public');

    const listed = listRegistrySkills(index, { catalog: 'public' });
    assert.ok(listed.skills.some((s) => s.name === 'legacy-public'));
  });

  it('AE-037a_non_public_without_tenant_id_fails_closed_on_publish', () => {
    const registry = path.join(tmpRoot, 'reg-no-tenant');
    const src = path.join(tmpRoot, 'src-no-tenant');
    writePackage(src, baseManifest('needs-tenant', '1.0.0'));
    const pub = publishFirstParty({
      registryRoot: registry,
      sourceDir: src,
      actor: 'ae037a-tester',
      visibility: 'private',
      owner_id: 'user-1',
      // tenant_id intentionally omitted — must not infer
    });
    assert.equal(pub.ok, false);
    assert.equal(pub.code, 'TENANT_REQUIRED');
  });
});
