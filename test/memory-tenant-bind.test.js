'use strict';

/**
 * AE-036c — MemoryService + skill lookup bind tenant/org.
 * Request without tenant_id does not see shared org memory.
 * Refs ADR-017 A2/A3; PD-53.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createMemoryService } = require('../scripts/lib/memory/memory-service.cjs');
const { lookupSkillMemory } = require('../scripts/lib/memory/skill-memory-lookup.cjs');
const {
  resolveMemoryBinding,
  recordVisibleUnderBinding,
  isSharedOrgTenant,
} = require('../scripts/lib/memory/memory-binding.cjs');

const pluginRoot = path.resolve(__dirname, '..');

function provenance(origin) {
  return {
    origin,
    actor: 'user:test',
    source_hash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    ingested_at: '2026-11-14T12:00:00.000Z',
  };
}

describe('AE-036c memory tenant/org binding', () => {
  /** @type {string} */
  let tmp;
  /** @type {string} */
  let personal;
  let prevPersonal;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae036c-'));
    personal = fs.mkdtempSync(path.join(os.tmpdir(), 'ae036c-personal-'));
    prevPersonal = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = personal;
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'ae036c', version: '1.0.0' })
    );
    fs.mkdirSync(path.join(tmp, '.agentic-swe'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.agentic-swe', 'tenant.json'),
      JSON.stringify({ tenant_id: 'pilot-acme', share_org_memory: false }),
      'utf8'
    );
  });

  after(() => {
    if (prevPersonal === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
    else process.env.AGENTIC_SWE_PERSONAL_ROOT = prevPersonal;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(personal, { recursive: true, force: true });
  });

  it('isSharedOrgTenant treats personal/local as non-shared', () => {
    assert.equal(isSharedOrgTenant('personal'), false);
    assert.equal(isSharedOrgTenant('local'), false);
    assert.equal(isSharedOrgTenant('pilot-acme'), true);
    assert.equal(isSharedOrgTenant(''), false);
  });

  it('resolveMemoryBinding leaves tenant unbound when caller omits tenant_id', () => {
    const unbound = resolveMemoryBinding(tmp, {});
    assert.equal(unbound.tenant_id, null);
    assert.equal(unbound.pilot_tenant_id, 'pilot-acme');
    const bound = resolveMemoryBinding(tmp, {
      tenant_id: 'pilot-acme',
      org_id: 'org:acme',
    });
    assert.equal(bound.tenant_id, 'pilot-acme');
    assert.equal(bound.org_id, 'org:acme');
  });

  it('shared org memory invisible without tenant_id; visible with matching binding', async () => {
    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      await svc.write({
        id: 'mem:org:local-pd46',
        scope: 'organizational',
        body: 'local private lesson LOCAL_ONLY_036c',
        provenance: provenance('local-sync'),
        // default tenant_id → local via resolveTenantLabel
      });
      await svc.write({
        id: 'mem:org:shared-pilot',
        scope: 'organizational',
        body: 'shared pilot lesson SHARED_PILOT_036c',
        tenant_id: 'pilot-acme',
        org_id: 'org:acme',
        provenance: provenance('pilot-sync'),
      });

      const noTenant = await svc.read({ scope: 'organizational' });
      const noIds = noTenant.records.map((r) => r.id);
      assert.ok(noIds.includes('mem:org:local-pd46'));
      assert.ok(
        !noIds.includes('mem:org:shared-pilot'),
        'shared org memory must be hidden without tenant_id'
      );

      const withTenant = await svc.read({
        scope: 'organizational',
        tenant_id: 'pilot-acme',
        org_id: 'org:acme',
      });
      const withIds = withTenant.records.map((r) => r.id);
      assert.ok(withIds.includes('mem:org:shared-pilot'));
      assert.ok(withIds.includes('mem:org:local-pd46'));

      const wrongOrg = await svc.read({
        scope: 'organizational',
        tenant_id: 'pilot-acme',
        org_id: 'org:other',
      });
      assert.ok(!wrongOrg.records.map((r) => r.id).includes('mem:org:shared-pilot'));
    } finally {
      await svc.close();
    }
  });

  it('caller cannot assert a broader tenant than pilot config on write', async () => {
    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      await assert.rejects(
        () =>
          svc.write({
            id: 'mem:org:evil',
            scope: 'organizational',
            body: 'evil',
            tenant_id: 'other-tenant',
            provenance: provenance('evil'),
          }),
        (err) => err && err.code === 'TENANT_MISMATCH'
      );
    } finally {
      await svc.close();
    }
  });

  it('skill memory lookup without tenant_id omits shared org memory', async () => {
    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      await svc.write({
        id: 'mem:skill:personal',
        scope: 'skill',
        body: 'personal muscle SKILL_PERSONAL_036c',
        provenance: provenance('skill'),
      });
      await svc.write({
        id: 'mem:org:shared-for-skill',
        scope: 'organizational',
        body: 'org skill hint ORG_SKILL_036c',
        tenant_id: 'pilot-acme',
        org_id: 'org:acme',
        provenance: provenance('org-skill'),
      });

      const unbound = await lookupSkillMemory(svc, {
        projectRoot: tmp,
        query: '036c',
      });
      assert.equal(unbound.binding.tenant_id, null);
      assert.ok(unbound.skill.some((r) => r.id === 'mem:skill:personal'));
      assert.ok(
        !unbound.organizational.some((r) => r.id === 'mem:org:shared-for-skill'),
        'skill lookup without tenant must not see shared org memory'
      );

      const bound = await lookupSkillMemory(svc, {
        projectRoot: tmp,
        tenant_id: 'pilot-acme',
        org_id: 'org:acme',
        query: '036c',
      });
      assert.ok(bound.organizational.some((r) => r.id === 'mem:org:shared-for-skill'));
    } finally {
      await svc.close();
    }
  });

  it('recordVisibleUnderBinding fails closed for shared row without org when org stamped', () => {
    const shared = {
      scope: 'organizational',
      tenant_id: 'pilot-acme',
      org_id: 'org:acme',
    };
    assert.equal(recordVisibleUnderBinding(shared, { tenant_id: null, org_id: null }), false);
    assert.equal(
      recordVisibleUnderBinding(shared, { tenant_id: 'pilot-acme', org_id: null }),
      false
    );
    assert.equal(
      recordVisibleUnderBinding(shared, { tenant_id: 'pilot-acme', org_id: 'org:acme' }),
      true
    );
  });
});
