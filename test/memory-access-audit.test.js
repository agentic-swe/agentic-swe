'use strict';

/**
 * AE-038c — auditable access/delete; sensitive fixture unreadable after delete.
 * Refs ADR-012; ADR-017.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createMemoryService } = require('../scripts/lib/memory/memory-service.cjs');
const {
  readMemoryAccessAudit,
  memoryAccessAuditPath,
} = require('../scripts/lib/memory/memory-access-audit.cjs');

const pluginRoot = path.resolve(__dirname, '..');

function provenance(origin) {
  return {
    origin,
    actor: 'user:test',
    source_hash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    ingested_at: '2026-11-14T15:00:00.000Z',
  };
}

describe('AE-038c memory access/delete audit + sensitive delete', () => {
  /** @type {string} */
  let tmp;
  /** @type {string} */
  let personal;
  let prevPersonal;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae038c-'));
    personal = fs.mkdtempSync(path.join(os.tmpdir(), 'ae038c-p-'));
    prevPersonal = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = personal;
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'ae038c', version: '1.0.0' })
    );
  });

  after(() => {
    if (prevPersonal === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
    else process.env.AGENTIC_SWE_PERSONAL_ROOT = prevPersonal;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(personal, { recursive: true, force: true });
  });

  it('read and delete emit auditable records (ids only, no bodies)', async () => {
    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      await svc.write({
        id: 'mem:org:audit-me',
        scope: 'organizational',
        body: 'lesson AUDIT_BODY_038c should not appear in audit log',
        provenance: provenance('audit'),
      });
      await svc.read({ scope: 'organizational', query: 'AUDIT_BODY' });
      await svc.delete({ id: 'mem:org:audit-me', scope: 'organizational' });

      const audit = readMemoryAccessAudit(tmp);
      assert.ok(audit.some((e) => e.action === 'read'));
      assert.ok(audit.some((e) => e.action === 'delete'));
      const del = audit.filter((e) => e.action === 'delete').pop();
      assert.ok(del.record_ids.includes('mem:org:audit-me'));
      const raw = fs.readFileSync(memoryAccessAuditPath(tmp), 'utf8');
      assert.ok(!raw.includes('AUDIT_BODY_038c'), 'audit must not contain sensitive body');
    } finally {
      await svc.close();
    }
  });

  it('sensitive-data fixture cannot be read back after delete', async () => {
    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      const SENSITIVE = 'SENSITIVE_SECRET_TOKEN_038c_DO_NOT_LEAK';
      await svc.write({
        id: 'mem:org:sensitive',
        scope: 'organizational',
        body: `contains ${SENSITIVE} for enterprise sensitive handling`,
        provenance: provenance('sensitive'),
        // redact on write may alter body — still assert post-delete miss by id
      });

      const before = await svc.read({
        scope: 'organizational',
        query: 'SENSITIVE_SECRET_TOKEN_038c',
      });
      // May be redacted; presence of id is enough pre-delete.
      const beforeIds = before.records.map((r) => r.id);
      assert.ok(
        beforeIds.includes('mem:org:sensitive') ||
          before.records.some((r) => String(r.body || '').includes('SENSITIVE')),
        'sensitive fixture should be readable before delete'
      );

      const del = await svc.delete({ id: 'mem:org:sensitive', scope: 'organizational' });
      assert.ok(del.deleted.includes('mem:org:sensitive'));

      const after = await svc.read({
        scope: 'organizational',
        query: 'SENSITIVE_SECRET_TOKEN_038c',
      });
      assert.ok(!after.records.map((r) => r.id).includes('mem:org:sensitive'));
      assert.ok(
        !after.records.some((r) => String(r.body || '').includes('SENSITIVE_SECRET_TOKEN_038c')),
        'sensitive token must not be readable after delete'
      );

      const byId = await svc.read({ scope: 'organizational' });
      assert.ok(!byId.records.map((r) => r.id).includes('mem:org:sensitive'));
    } finally {
      await svc.close();
    }
  });
});
