'use strict';

/**
 * AE-037b — server-side search/list visibility enforcement (ADR-017 A4).
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  publishSkill,
  listRegistrySkills,
  searchRegistrySkills,
  sanitizeRegistryQueryOpts,
  readIndex,
  INDEX_NAME,
} = require('../scripts/lib/skills/skill-registry.cjs');
const { digestSkillBody } = require('../scripts/lib/skills/skill-integrity.cjs');
const { buildApprovedPublishReview } = require('../scripts/lib/skills/skill-publish-review.cjs');

const tmpRoot = path.join(__dirname, '_tmp-skill-registry-search');
const FIXTURE_INDEX = path.join(
  __dirname,
  'fixtures',
  'skill-visibility-search',
  'skills-index.json'
);

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
    description: `Search fixture ${name}`,
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

describe('AE-037b server-side search/list visibility', () => {
  before(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('AE-037b_fixture_private_skill_absent_from_public_search', () => {
    const index = JSON.parse(fs.readFileSync(FIXTURE_INDEX, 'utf8'));
    assert.ok(index.skills['fixture-private-secret']);
    assert.ok(index.skills['fixture-org-internal']);
    assert.ok(index.skills['fixture-public-search']);

    const listed = listRegistrySkills(index, { catalog: 'public' });
    assert.equal(listed.ok, true);
    assert.deepEqual(
      listed.skills.map((s) => s.name),
      ['fixture-public-search']
    );

    const searched = searchRegistrySkills(index, 'secret', { catalog: 'public' });
    assert.equal(searched.ok, true);
    // Query matches private description text, but server-side filter excludes it.
    assert.equal(searched.skills.length, 0);
    assert.ok(!searched.skills.some((s) => s.name === 'fixture-private-secret'));

    const searchedPublic = searchRegistrySkills(index, 'Public searchable', {
      catalog: 'public',
    });
    assert.equal(searchedPublic.ok, true);
    assert.deepEqual(
      searchedPublic.skills.map((s) => s.name),
      ['fixture-public-search']
    );

    // Org skill also absent from public search even when query matches.
    const orgHit = searchRegistrySkills(index, 'Organization skill', { catalog: 'public' });
    assert.equal(orgHit.skills.length, 0);
  });

  it('AE-037b_include_private_query_cannot_widen_results', () => {
    const index = JSON.parse(fs.readFileSync(FIXTURE_INDEX, 'utf8'));

    const sanitized = sanitizeRegistryQueryOpts({
      catalog: 'public',
      includePrivate: true,
      include_private: true,
      visibilities: ['public', 'private', 'organization'],
    });
    assert.ok(sanitized.ignored.includes('includePrivate'));
    assert.ok(sanitized.ignored.includes('visibilities'));
    assert.equal(sanitized.opts.includePrivate, undefined);
    assert.equal(sanitized.opts.visibilities, undefined);

    const attack = searchRegistrySkills(index, {
      query: 'secret',
      catalog: 'public',
      includePrivate: true,
      include_private: true,
      visibilities: ['private', 'organization', 'team', 'public'],
      viewer: { includePrivate: true, catalog: 'public' },
    });
    assert.equal(attack.ok, true);
    assert.ok(attack.ignored && attack.ignored.includes('includePrivate'));
    assert.equal(attack.skills.length, 0);
    assert.ok(!attack.skills.some((s) => s.visibility === 'private'));
    assert.ok(!attack.skills.some((s) => s.visibility === 'organization'));

    const listAttack = listRegistrySkills(index, {
      catalog: 'public',
      includePrivate: true,
      query: 'fixture',
    });
    assert.equal(listAttack.ok, true);
    assert.deepEqual(
      listAttack.skills.map((s) => s.name),
      ['fixture-public-search']
    );
  });

  it('AE-037b_server_side_list_and_search_enforce_visibility', () => {
    const registry = path.join(tmpRoot, 'reg-live');
    const srcPub = path.join(tmpRoot, 'src-live-pub');
    const srcPriv = path.join(tmpRoot, 'src-live-priv');
    writePackage(srcPub, baseManifest('live-public', '1.0.0'));
    writePackage(srcPriv, baseManifest('live-private', '1.0.0'));

    assert.equal(
      publishFirstParty({
        registryRoot: registry,
        sourceDir: srcPub,
        actor: 'ae037b-tester',
        visibility: 'public',
      }).ok,
      true
    );
    assert.equal(
      publishFirstParty({
        registryRoot: registry,
        sourceDir: srcPriv,
        actor: 'ae037b-tester',
        visibility: 'private',
        tenant_id: 'pilot-t1',
        owner_id: 'user-1',
      }).ok,
      true
    );

    const index = readIndex(path.join(registry, INDEX_NAME));
    const pubList = listRegistrySkills(index, { catalog: 'public' });
    assert.deepEqual(
      pubList.skills.map((s) => s.name),
      ['live-public']
    );

    // Authorized tenant+owner can see private via search when tenant_id is explicit.
    const ownerSearch = searchRegistrySkills(index, 'live', {
      tenant_id: 'pilot-t1',
      owner_id: 'user-1',
    });
    assert.equal(ownerSearch.ok, true);
    const names = ownerSearch.skills.map((s) => s.name).sort();
    assert.deepEqual(names, ['live-private', 'live-public']);

    // Forcing catalog=tenant without tenant_id is sanitized back to public.
    const forced = searchRegistrySkills(index, 'live', { catalog: 'tenant' });
    assert.ok(forced.ignored && forced.ignored.includes('catalog'));
    assert.deepEqual(
      forced.skills.map((s) => s.name),
      ['live-public']
    );
  });
});
