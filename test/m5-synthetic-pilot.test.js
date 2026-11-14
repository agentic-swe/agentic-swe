'use strict';

/**
 * M5 E12 — named synthetic controlled pilot (founder 2026-11-14 / NB5).
 * Two tenants in temp dirs; public AutoEng APIs only (org share, skill search,
 * org RBAC, backup-restore). No network. Refs ADR-017; PD-55.
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
} = require('../scripts/lib/memory/org-share.cjs');
const { checkOrgAccess } = require('../scripts/lib/memory/org-access.cjs');
const {
  publishSkill,
  searchRegistrySkills,
  readIndex,
  INDEX_NAME,
} = require('../scripts/lib/skills/skill-registry.cjs');
const { digestSkillBody } = require('../scripts/lib/skills/skill-integrity.cjs');
const { buildApprovedPublishReview } = require('../scripts/lib/skills/skill-publish-review.cjs');
const { evaluate } = require('../scripts/lib/policy/pdp.cjs');
const { RULE_ID_DENY } = require('../scripts/lib/policy/org-rbac.cjs');
const {
  backupMemoryStore,
  restoreMemoryStore,
  tenantMemorySqlitePath,
  openTenantMemoryStore,
} = require('../scripts/lib/memory/backup-restore.cjs');

const pluginRoot = path.resolve(__dirname, '..');

const fixturePolicy = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'policy-runtime', 'policy.json'), 'utf8')
);

const FIRST_PARTY_MEMORY_SOURCE = Object.freeze({
  publicSafe: true,
  declaration: 'first-party',
});

const TENANT_A = 'pilot-tenant-a';
const TENANT_B = 'pilot-tenant-b';
const ORG_A = 'org:acme';
const ORG_B = 'org:globex';
const PRINCIPAL_A = 'user:alice@example.com';
const SHARE_MARKER = 'M5_PILOT_SHARE_A_ONLY';
const SECRET_A = 'M5_PILOT_SECRET_FROM_A';

function provenance(origin) {
  return {
    origin,
    actor: 'user:m5-pilot',
    source_hash: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    ingested_at: '2026-11-14T18:00:00.000Z',
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

function writePackage(dir, manifest, body = '# pilot body\n') {
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
        reviewer: 'm5-pilot-reviewer',
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
    description: `M5 pilot skill ${name}`,
    kind: 'prompt',
    inputs: [],
    outputs: [],
    dependencies: [],
    permissions: [],
    runtime: { node: '>=22.0.0' },
    compatibility: { pack: '^3.0.0' },
    validation: { rules: ['schema'] },
    provenance: { origin: 'first-party', authors: ['m5-pilot'] },
    maintainer: 'm5-pilot',
    ...extra,
  };
}

async function seedTenantMemory(storeRoot, tenantId, marker) {
  const { store, sqlitePath } = await openTenantMemoryStore(storeRoot, tenantId);
  try {
    await store.upsertChunk({
      chunkId: `${tenantId}-pilot-chunk`,
      path: `docs/${tenantId}.md`,
      workId: null,
      scope: 'organizational',
      body: marker,
      startLine: 1,
      endLine: 1,
      contentSha256: 'pilot',
      recordJson: JSON.stringify({
        provenance: provenance(`backup-${tenantId}`),
        trust: 'observed',
        tenant_id: tenantId,
      }),
    });
    await store.persist();
  } finally {
    await store.close();
  }
  return sqlitePath;
}

async function listBodies(sqlitePath) {
  const { createNodeSqliteMemoryStore } = require('../scripts/lib/memory/adapters/node-sqlite-memory-store.cjs');
  const store = createNodeSqliteMemoryStore({ sqlitePath });
  await store.open();
  try {
    const rows = await store.listChunks({ limit: 100 });
    return rows.map((r) => r.body);
  } finally {
    await store.close();
  }
}

describe('M5 synthetic pilot (E12)', () => {
  /** @type {string} */
  let root;
  /** @type {string} */
  let personal;
  /** @type {string} */
  let tenantARoot;
  /** @type {string} */
  let tenantBRoot;
  /** @type {string} */
  let bareRoot;
  /** @type {string|undefined} */
  let prevPersonal;

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-synthetic-pilot-'));
    personal = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-pilot-personal-'));
    prevPersonal = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = personal;

    tenantARoot = path.join(root, 'tenant-a');
    tenantBRoot = path.join(root, 'tenant-b');
    bareRoot = path.join(root, 'bare-install');
    for (const dir of [tenantARoot, tenantBRoot, bareRoot]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: path.basename(dir), version: '1.0.0' })
      );
    }

    writeTenant(tenantARoot, { tenant_id: TENANT_A, share_org_memory: true });
    writeTenant(tenantBRoot, { tenant_id: TENANT_B, share_org_memory: true });
  });

  after(() => {
    if (prevPersonal === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
    else process.env.AGENTIC_SWE_PERSONAL_ROOT = prevPersonal;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(personal, { recursive: true, force: true });
  });

  it('tenant A opt-in share visible to authorized A principal, not to tenant B', async () => {
    assert.equal(orgShareStatus(tenantARoot).enabled, true);

    const svcA = createMemoryService({ pluginRoot, projectRoot: tenantARoot });
    try {
      const shared = await svcA.write({
        id: 'mem:org:m5-pilot-shared',
        scope: 'organizational',
        body: SHARE_MARKER,
        share: true,
        org_id: ORG_A,
        provenance: provenance('org-share'),
      });
      assert.equal(shared.tenant_id, TENANT_A);
      assert.equal(shared.org_id, ORG_A);
      assert.notEqual(shared.visibility, 'public');

      const readA = await svcA.read({
        scope: 'organizational',
        tenant_id: TENANT_A,
        org_id: ORG_A,
        query: 'M5_PILOT_SHARE',
      });
      assert.ok(readA.records.some((r) => r.id === 'mem:org:m5-pilot-shared'));
    } finally {
      await svcA.close();
    }

    const principalA = { tenant_id: TENANT_A, org_id: ORG_A, actor_id: PRINCIPAL_A };
    const resourceA = {
      tenant_id: TENANT_A,
      org_id: ORG_A,
      id: 'mem:org:m5-pilot-shared',
      type: 'memory',
    };
    assert.equal(checkOrgAccess(principalA, resourceA, 'read').allowed, true);

    const principalB = { tenant_id: TENANT_B, org_id: ORG_B, actor_id: 'user:bob@example.com' };
    const cross = checkOrgAccess(principalB, resourceA, 'read');
    assert.equal(cross.allowed, false);
    assert.equal(cross.code, 'CROSS_TENANT_DENIED');

    const svcB = createMemoryService({ pluginRoot, projectRoot: tenantBRoot });
    try {
      const readB = await svcB.read({
        scope: 'organizational',
        tenant_id: TENANT_B,
        org_id: ORG_B,
        query: 'M5_PILOT_SHARE',
      });
      assert.ok(!readB.records.some((r) => r.id === 'mem:org:m5-pilot-shared'));
      assert.ok(!readB.records.some((r) => String(r.body || '').includes(SHARE_MARKER)));
    } finally {
      await svcB.close();
    }
  });

  it('install without tenant opt-in stays local-private', async () => {
    // No tenant.json → PD-46 local-private; share writes fail closed.
    assert.equal(orgShareStatus(bareRoot).enabled, false);

    const svc = createMemoryService({ pluginRoot, projectRoot: bareRoot });
    try {
      const written = await svc.write({
        id: 'mem:org:m5-pilot-local',
        scope: 'organizational',
        body: 'local private NO_OPT_IN_M5',
        provenance: provenance('local'),
      });
      assert.equal(written.tenant_id, 'local');
      assert.ok(written.visibility === 'private' || written.visibility === 'local');

      await assert.rejects(
        () =>
          svc.write({
            id: 'mem:org:m5-pilot-share-denied',
            scope: 'organizational',
            body: 'should fail',
            share: true,
            org_id: ORG_A,
            provenance: provenance('share'),
          }),
        (err) => err && err.code === 'ORG_SHARE_NOT_ENABLED'
      );
    } finally {
      await svc.close();
    }

    assert.throws(
      () =>
        prepareOrgShareWrite(bareRoot, {
          scope: 'organizational',
          share: true,
          org_id: ORG_A,
        }),
      (err) => err && err.code === 'ORG_SHARE_NOT_ENABLED'
    );
  });

  it('private skill is absent from public search', () => {
    const registry = path.join(root, 'skill-registry');
    const srcPub = path.join(root, 'src-public');
    const srcPriv = path.join(root, 'src-private');
    writePackage(srcPub, baseManifest('m5-pilot-public', '1.0.0', {
      description: 'M5 pilot Public searchable skill',
    }));
    writePackage(srcPriv, baseManifest('m5-pilot-private-secret', '1.0.0', {
      description: 'M5 pilot Private secret skill',
    }));

    assert.equal(
      publishSkill({
        registryRoot: registry,
        sourceDir: srcPub,
        actor: 'm5-pilot',
        visibility: 'public',
        memorySource: FIRST_PARTY_MEMORY_SOURCE,
      }).ok,
      true
    );
    assert.equal(
      publishSkill({
        registryRoot: registry,
        sourceDir: srcPriv,
        actor: 'm5-pilot',
        visibility: 'private',
        tenant_id: TENANT_A,
        owner_id: 'user-alice',
        memorySource: FIRST_PARTY_MEMORY_SOURCE,
      }).ok,
      true
    );

    const index = readIndex(path.join(registry, INDEX_NAME));
    const publicHit = searchRegistrySkills(index, 'secret', { catalog: 'public' });
    assert.equal(publicHit.ok, true);
    assert.equal(publicHit.skills.length, 0);
    assert.ok(!publicHit.skills.some((s) => s.name === 'm5-pilot-private-secret'));

    const named = searchRegistrySkills(index, 'Private secret', { catalog: 'public' });
    assert.equal(named.skills.length, 0);

    const ownerSearch = searchRegistrySkills(index, 'pilot', {
      tenant_id: TENANT_A,
      owner_id: 'user-alice',
    });
    assert.ok(ownerSearch.skills.some((s) => s.name === 'm5-pilot-private-secret'));
  });

  it('caller-supplied grant does not elevate an org-scoped action', () => {
    const bindingsDir = path.join(root, 'org-rbac-empty');
    fs.mkdirSync(bindingsDir, { recursive: true });

    const d = evaluate({
      policy: fixturePolicy,
      toolName: 'Bash',
      toolInput: { command: 'echo hi' },
      tenant_id: TENANT_A,
      org_id: 'acme',
      principal: 'user:bob@example.com',
      action: 'org.memory.read',
      orgRbacDir: bindingsDir,
      authorized: new Set(['org.memory.read', 'org.admin', 'github.pr.write']),
      flags: {
        org_authorized: true,
        authorized: true,
        humanAuthorized: true,
        org_rbac_bypass: true,
      },
      org_grants: [{ action: 'org.memory.read', principal: 'user:bob@example.com' }],
      grants: ['org.memory.read'],
    });
    assert.equal(d.decision, 'deny');
    assert.equal(d.rule_id, RULE_ID_DENY);
    assert.equal(d.code, 'ORG_RBAC_DENY');
  });

  it('backup of tenant A restored for A is not readable as tenant B', async () => {
    const storeRoot = path.join(root, 'memory-stores');
    const pathA = await seedTenantMemory(storeRoot, TENANT_A, SECRET_A);
    const pathB = await seedTenantMemory(storeRoot, TENANT_B, 'data-from-B');
    assert.notEqual(pathA, pathB);
    assert.equal(pathA, tenantMemorySqlitePath(storeRoot, TENANT_A));
    assert.equal(pathB, tenantMemorySqlitePath(storeRoot, TENANT_B));

    const { backupPath } = backupMemoryStore({ sqlitePath: pathA });
    fs.rmSync(pathA, { force: true });
    restoreMemoryStore({ sqlitePath: pathA, backupPath });

    const bodiesA = await listBodies(pathA);
    const bodiesB = await listBodies(pathB);
    assert.ok(bodiesA.includes(SECRET_A));
    assert.ok(!bodiesB.includes(SECRET_A));
    assert.ok(bodiesB.includes('data-from-B'));
    assert.ok(!bodiesA.includes('data-from-B'));
  });
});
