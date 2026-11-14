'use strict';

/**
 * AE-038a — org/team share inside one pilot tenant; private≠public; no silent widen.
 * Refs ADR-017 A1/A8; PD-53.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createMemoryService } = require('../scripts/lib/memory/memory-service.cjs');
const {
  orgShareStatus,
  prepareOrgShareWrite,
  migrateRecordOnShareEnable,
} = require('../scripts/lib/memory/org-share.cjs');

const pluginRoot = path.resolve(__dirname, '..');

function provenance(origin) {
  return {
    origin,
    actor: 'user:test',
    source_hash: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    ingested_at: '2026-11-14T13:00:00.000Z',
  };
}

function writeTenant(dir, body) {
  fs.mkdirSync(path.join(dir, '.agentic-swe'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.agentic-swe', 'tenant.json'),
    JSON.stringify(body),
    'utf8'
  );
}

describe('AE-038a org/team share opt-in', () => {
  /** @type {string} */
  let tmp;
  /** @type {string} */
  let personal;
  let prevPersonal;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae038a-'));
    personal = fs.mkdtempSync(path.join(os.tmpdir(), 'ae038a-personal-'));
    prevPersonal = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = personal;
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'ae038a', version: '1.0.0' })
    );
  });

  after(() => {
    if (prevPersonal === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
    else process.env.AGENTIC_SWE_PERSONAL_ROOT = prevPersonal;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(personal, { recursive: true, force: true });
  });

  it('migration: install without opt-in stays local-private', async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ae038a-bare-'));
    const barePersonal = fs.mkdtempSync(path.join(os.tmpdir(), 'ae038a-bare-p-'));
    const prev = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = barePersonal;
    try {
      fs.writeFileSync(
        path.join(bare, 'package.json'),
        JSON.stringify({ name: 'bare', version: '1.0.0' })
      );
      // No tenant.json at all
      assert.equal(orgShareStatus(bare).enabled, false);

      const svc = createMemoryService({ pluginRoot, projectRoot: bare });
      try {
        const written = await svc.write({
          id: 'mem:org:local-default',
          scope: 'organizational',
          body: 'stays local NO_OPT_IN_038a',
          provenance: provenance('local'),
        });
        assert.equal(written.tenant_id, 'local');
        assert.ok(written.visibility === 'private' || written.visibility === 'local');

        await assert.rejects(
          () =>
            svc.write({
              id: 'mem:org:shared-denied',
              scope: 'organizational',
              body: 'should fail',
              share: true,
              org_id: 'org:acme',
              provenance: provenance('share'),
            }),
          (err) => err && err.code === 'ORG_SHARE_NOT_ENABLED'
        );
      } finally {
        await svc.close();
      }
    } finally {
      if (prev === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
      else process.env.AGENTIC_SWE_PERSONAL_ROOT = prev;
      fs.rmSync(bare, { recursive: true, force: true });
      fs.rmSync(barePersonal, { recursive: true, force: true });
    }
  });

  it('tenant.json without share_org_memory denies shared writes', () => {
    writeTenant(tmp, { tenant_id: 'pilot-acme' });
    assert.equal(orgShareStatus(tmp).enabled, false);
    assert.throws(
      () =>
        prepareOrgShareWrite(tmp, {
          scope: 'organizational',
          share: true,
          org_id: 'org:acme',
        }),
      (err) => err && err.code === 'ORG_SHARE_NOT_ENABLED'
    );
    assert.throws(
      () =>
        prepareOrgShareWrite(tmp, {
          scope: 'organizational',
          tenant_id: 'pilot-acme',
          org_id: 'org:acme',
        }),
      (err) => err && err.code === 'ORG_SHARE_NOT_ENABLED'
    );
  });

  it('with opt-in, org/team share works inside pilot tenant only; private≠public', async () => {
    writeTenant(tmp, { tenant_id: 'pilot-acme', share_org_memory: true });
    assert.equal(orgShareStatus(tmp).enabled, true);

    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      const orgShared = await svc.write({
        id: 'mem:org:shared-ok',
        scope: 'organizational',
        body: 'shared org lesson SHARE_ORG_038a',
        share: true,
        org_id: 'org:acme',
        provenance: provenance('org-share'),
      });
      assert.equal(orgShared.tenant_id, 'pilot-acme');
      assert.equal(orgShared.org_id, 'org:acme');
      assert.notEqual(orgShared.visibility, 'public');

      const teamShared = await svc.write({
        id: 'mem:org:team-ok',
        scope: 'organizational',
        body: 'shared team lesson SHARE_TEAM_038a',
        share: true,
        org_id: 'org:acme',
        team_id: 'team:platform',
        provenance: provenance('team-share'),
      });
      assert.equal(teamShared.tenant_id, 'pilot-acme');
      assert.equal(teamShared.team_id, 'team:platform');
      assert.notEqual(teamShared.visibility, 'public');

      await assert.rejects(
        () =>
          svc.write({
            id: 'mem:org:public-forbidden',
            scope: 'organizational',
            body: 'nope',
            share: true,
            org_id: 'org:acme',
            visibility: 'public',
            provenance: provenance('public'),
          }),
        (err) =>
          err &&
          (err.code === 'ORG_MEMORY_PUBLIC_FORBIDDEN' ||
            err.code === 'ORG_MEMORY_PUBLIC_FORBIDDEN')
      );

      // Bound read sees shared rows
      const read = await svc.read({
        scope: 'organizational',
        tenant_id: 'pilot-acme',
        org_id: 'org:acme',
        query: 'SHARE_',
      });
      const ids = read.records.map((r) => r.id);
      assert.ok(ids.includes('mem:org:shared-ok'));
      assert.ok(ids.includes('mem:org:team-ok'));
    } finally {
      await svc.close();
    }
  });

  it('enabling share does not flip private records to public', () => {
    const privateRec = {
      id: 'mem:org:old',
      scope: 'organizational',
      tenant_id: 'local',
      visibility: 'private',
      body: 'old private',
    };
    const migrated = migrateRecordOnShareEnable(privateRec);
    assert.equal(migrated.visibility, 'private');
    assert.notEqual(migrated.visibility, 'public');
    assert.equal(privateRec.visibility, 'private');
  });
});
