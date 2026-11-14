'use strict';

/**
 * AE-036b — cross-org / cross-tenant deny; same-org allow.
 * Two synthetic orgs (and two tenants) on disk. Refs ADR-017 A1; PD-53.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { checkOrgAccess, assertOrgAccess } = require('../scripts/lib/memory/org-access.cjs');
const { createOrgStore } = require('../scripts/lib/memory/org-store.cjs');

const KNOWN_OWNERS = [
  { kind: 'user', id: 'user:founder-a' },
  { kind: 'user', id: 'user:founder-b' },
  { kind: 'organization', id: 'org:acme' },
  { kind: 'organization', id: 'org:globex' },
];

describe('AE-036b org access checks', () => {
  it('same-org same-tenant read/write allowed', () => {
    const principal = { tenant_id: 'pilot-a', org_id: 'org:acme', actor_id: 'user:alice' };
    const resource = {
      tenant_id: 'pilot-a',
      org_id: 'org:acme',
      id: 'team:platform',
      type: 'team',
    };
    assert.equal(checkOrgAccess(principal, resource, 'read').allowed, true);
    assert.equal(checkOrgAccess(principal, resource, 'write').allowed, true);
    assert.doesNotThrow(() => assertOrgAccess(principal, resource, 'read'));
  });

  it('cross-org read/write denied (same tenant)', () => {
    const principal = { tenant_id: 'pilot-a', org_id: 'org:acme' };
    const resource = { tenant_id: 'pilot-a', org_id: 'org:globex', id: 'team:x', type: 'team' };
    const read = checkOrgAccess(principal, resource, 'read');
    assert.equal(read.allowed, false);
    assert.equal(read.code, 'CROSS_ORG_DENIED');
    const write = checkOrgAccess(principal, resource, 'write');
    assert.equal(write.allowed, false);
    assert.equal(write.code, 'CROSS_ORG_DENIED');
    assert.throws(
      () => assertOrgAccess(principal, resource, 'write'),
      (err) => err && err.code === 'CROSS_ORG_DENIED'
    );
  });

  it('cross-tenant read/write denied', () => {
    const principal = { tenant_id: 'pilot-a', org_id: 'org:acme' };
    const resource = { tenant_id: 'pilot-b', org_id: 'org:acme', id: 'team:x', type: 'team' };
    const read = checkOrgAccess(principal, resource, 'read');
    assert.equal(read.allowed, false);
    assert.equal(read.code, 'CROSS_TENANT_DENIED');
    assert.throws(
      () => assertOrgAccess(principal, resource, 'read'),
      (err) => err && err.code === 'CROSS_TENANT_DENIED'
    );
  });

  it('missing tenant or org binding fails closed', () => {
    assert.equal(
      checkOrgAccess({ tenant_id: '', org_id: 'org:acme' }, { tenant_id: 't', org_id: 'org:acme' }, 'read')
        .code,
      'MISSING_TENANT_BINDING'
    );
    assert.equal(
      checkOrgAccess(
        { tenant_id: 'pilot-a', org_id: '  ' },
        { tenant_id: 'pilot-a', org_id: 'org:acme' },
        'read'
      ).code,
      'MISSING_ORG_BINDING'
    );
    assert.equal(
      checkOrgAccess(
        { tenant_id: 'pilot-a', org_id: 'org:acme' },
        { tenant_id: 'pilot-a', org_id: null, type: 'team', id: 'team:x' },
        'read'
      ).code,
      'MISSING_ORG_BINDING'
    );
  });

  it('organization resource uses id as org_id when org_id null', () => {
    const principal = { tenant_id: 'pilot-a', org_id: 'org:acme' };
    const resource = {
      tenant_id: 'pilot-a',
      org_id: null,
      id: 'org:acme',
      type: 'organization',
    };
    assert.equal(checkOrgAccess(principal, resource, 'read').allowed, true);
  });
});

describe('AE-036b disk store with two synthetic orgs/tenants', () => {
  /** @type {string} */
  let root;
  /** @type {ReturnType<typeof createOrgStore>} */
  let store;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ae036b-orgs-'));
    store = createOrgStore({ storeRoot: root, knownOwners: KNOWN_OWNERS });

    const orgA = {
      id: 'org:acme',
      type: 'organization',
      tenant_id: 'pilot-a',
      display_name: 'Acme',
      owner: { kind: 'user', id: 'user:founder-a' },
      org_id: null,
    };
    const teamA = {
      id: 'team:platform',
      type: 'team',
      tenant_id: 'pilot-a',
      display_name: 'Platform',
      owner: { kind: 'organization', id: 'org:acme' },
      org_id: 'org:acme',
      parent_id: 'org:acme',
    };
    const orgB = {
      id: 'org:globex',
      type: 'organization',
      tenant_id: 'pilot-b',
      display_name: 'Globex',
      owner: { kind: 'user', id: 'user:founder-b' },
      org_id: null,
    };
    const teamB = {
      id: 'team:research',
      type: 'team',
      tenant_id: 'pilot-b',
      display_name: 'Research',
      owner: { kind: 'organization', id: 'org:globex' },
      org_id: 'org:globex',
      parent_id: 'org:globex',
    };

    store.writeResource(orgA, { principal: { tenant_id: 'pilot-a', org_id: 'org:acme' } });
    store.writeResource(teamA, { principal: { tenant_id: 'pilot-a', org_id: 'org:acme' } });
    store.writeResource(orgB, { principal: { tenant_id: 'pilot-b', org_id: 'org:globex' } });
    store.writeResource(teamB, { principal: { tenant_id: 'pilot-b', org_id: 'org:globex' } });
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('isolates tenant store paths on disk', () => {
    const pathA = store.tenantDir('pilot-a');
    const pathB = store.tenantDir('pilot-b');
    assert.notEqual(pathA, pathB);
    assert.ok(fs.existsSync(pathA));
    assert.ok(fs.existsSync(pathB));
    assert.ok(fs.existsSync(path.join(pathA, 'org:acme.json')));
    assert.ok(fs.existsSync(path.join(pathB, 'org:globex.json')));
    // No cross-tenant leakage in directory listing
    assert.equal(fs.existsSync(path.join(pathA, 'org:globex.json')), false);
    assert.equal(fs.existsSync(path.join(pathB, 'org:acme.json')), false);
  });

  it('same-org principal can read own team; cross-org denied', () => {
    const alice = { tenant_id: 'pilot-a', org_id: 'org:acme', actor_id: 'user:alice' };
    const team = store.readResource({ tenant_id: 'pilot-a', id: 'team:platform' }, { principal: alice });
    assert.equal(team.id, 'team:platform');

    // Same tenant, different org — fabricate a resource under acme tenant but globex org is impossible
    // via store write; unit-check via assert on a foreign org_id resource already on disk is N/A.
    // Cross-org: alice cannot read a team that would belong to another org if injected.
    assert.throws(
      () =>
        assertOrgAccess(
          alice,
          { tenant_id: 'pilot-a', org_id: 'org:other', id: 'team:x', type: 'team' },
          'read'
        ),
      (err) => err && err.code === 'CROSS_ORG_DENIED'
    );
  });

  it('cross-tenant read denied at store boundary', () => {
    const alice = { tenant_id: 'pilot-a', org_id: 'org:acme' };
    assert.throws(
      () => store.readResource({ tenant_id: 'pilot-b', id: 'team:research' }, { principal: alice }),
      (err) => err && err.code === 'CROSS_TENANT_DENIED'
    );
  });

  it('cross-tenant write denied at store boundary', () => {
    const alice = { tenant_id: 'pilot-a', org_id: 'org:acme' };
    assert.throws(
      () =>
        store.writeResource(
          {
            id: 'team:evil',
            type: 'team',
            tenant_id: 'pilot-b',
            display_name: 'Evil',
            owner: { kind: 'organization', id: 'org:globex' },
            org_id: 'org:globex',
          },
          { principal: alice }
        ),
      (err) => err && (err.code === 'CROSS_TENANT_DENIED' || err.code === 'CROSS_ORG_DENIED')
    );
  });

  it('listResources only returns same-org rows for the principal', () => {
    // Seed a second org under pilot-a to prove cross-org filter within one tenant dir.
    const known = [
      ...KNOWN_OWNERS,
      { kind: 'organization', id: 'org:sibling' },
      { kind: 'user', id: 'user:sib' },
    ];
    const multi = createOrgStore({ storeRoot: path.join(root, 'multi'), knownOwners: known });
    multi.writeResource(
      {
        id: 'org:acme',
        type: 'organization',
        tenant_id: 'pilot-a',
        display_name: 'Acme',
        owner: { kind: 'user', id: 'user:founder-a' },
      },
      { principal: { tenant_id: 'pilot-a', org_id: 'org:acme' } }
    );
    multi.writeResource(
      {
        id: 'team:platform',
        type: 'team',
        tenant_id: 'pilot-a',
        display_name: 'Platform',
        owner: { kind: 'organization', id: 'org:acme' },
        org_id: 'org:acme',
      },
      { principal: { tenant_id: 'pilot-a', org_id: 'org:acme' } }
    );
    multi.writeResource(
      {
        id: 'org:sibling',
        type: 'organization',
        tenant_id: 'pilot-a',
        display_name: 'Sibling',
        owner: { kind: 'user', id: 'user:sib' },
      },
      { principal: { tenant_id: 'pilot-a', org_id: 'org:sibling' } }
    );
    multi.writeResource(
      {
        id: 'team:sib',
        type: 'team',
        tenant_id: 'pilot-a',
        display_name: 'Sib Team',
        owner: { kind: 'organization', id: 'org:sibling' },
        org_id: 'org:sibling',
      },
      { principal: { tenant_id: 'pilot-a', org_id: 'org:sibling' } }
    );

    const listed = multi.listResources('pilot-a', {
      principal: { tenant_id: 'pilot-a', org_id: 'org:acme' },
    });
    const ids = listed.map((r) => r.id).sort();
    assert.deepEqual(ids, ['org:acme', 'team:platform']);
    assert.ok(!ids.includes('team:sib'));
    assert.ok(!ids.includes('org:sibling'));
  });
});
