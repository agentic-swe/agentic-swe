'use strict';

/**
 * AE-039c / ADR-017: admin audit log of org RBAC access decisions + retention.
 *
 * Defaults (documented; PD-47-style organizational class):
 *   ttl_days = 365 (organizational 1y). No network. Disk JSONL only.
 *
 * Admin list/expire require a disk org RBAC binding for
 * `org.audit.read` / `org.audit.expire`. Unauthorized → deny.
 *
 * Layer: policy (core).
 */

const fs = require('node:fs');
const path = require('node:path');
const { evaluateOrgAccess } = require('./org-rbac.cjs');

const AUDIT_REL = path.join('.agentic-swe', 'org-access-audit.jsonl');
/** PD-47 organizational retention class: 1 year. */
const DEFAULT_TTL_DAYS = 365;
const ADMIN_READ_ACTION = 'org.audit.read';
const ADMIN_EXPIRE_ACTION = 'org.audit.expire';

function auditPath(projectRoot) {
  return path.join(path.resolve(projectRoot), AUDIT_REL);
}

/**
 * Append one org access decision. Never stores caller grants or secret bodies.
 * @param {string} projectRoot
 * @param {object} entry
 */
function appendOrgAccessAudit(projectRoot, entry = {}) {
  if (!projectRoot || typeof projectRoot !== 'string') {
    throw new Error('appendOrgAccessAudit requires projectRoot');
  }
  const file = auditPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row = {
    at: new Date().toISOString(),
    kind: 'org.access',
    tenant_id: entry.tenant_id != null ? String(entry.tenant_id) : null,
    resource_type: entry.resource_type != null ? String(entry.resource_type) : null,
    resource_id: entry.resource_id != null ? String(entry.resource_id) : null,
    principal: entry.principal != null ? String(entry.principal) : null,
    action: entry.action != null ? String(entry.action) : null,
    decision: entry.decision != null ? String(entry.decision) : null,
    rule_id: entry.rule_id != null ? String(entry.rule_id) : null,
    code: entry.code != null ? String(entry.code) : null,
  };
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
  return row;
}

function readAll(projectRoot) {
  const file = auditPath(projectRoot);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/**
 * Retention status for the org access audit store (no admin gate — metadata only).
 */
function orgAccessAuditRetentionStatus(projectRoot, { ttlDays = DEFAULT_TTL_DAYS, now = Date.now() } = {}) {
  const rows = readAll(projectRoot);
  let oldest = null;
  let newest = null;
  let expired = 0;
  const cutoff = now - Number(ttlDays) * 86400000;
  for (const r of rows) {
    const t = Date.parse(r.at || '');
    if (!Number.isFinite(t)) continue;
    if (oldest == null || t < oldest) oldest = t;
    if (newest == null || t > newest) newest = t;
    if (t < cutoff) expired += 1;
  }
  return {
    ttl_days: Number(ttlDays),
    retention_class: 'organizational',
    source: 'PD-47 organizational 1y (AE-039c default)',
    count: rows.length,
    expired_count: expired,
    oldest_at: oldest != null ? new Date(oldest).toISOString() : null,
    newest_at: newest != null ? new Date(newest).toISOString() : null,
    path: AUDIT_REL,
  };
}

function assertAdmin({
  tenantId,
  resource,
  principal,
  action,
  bindingsDir,
  projectRoot,
  workDir,
}) {
  const verdict = evaluateOrgAccess({
    tenantId,
    resource,
    action,
    principal,
    bindingsDir,
    projectRoot,
    workDir,
  });
  if (verdict.decision !== 'allow') {
    return {
      ok: false,
      code: 'ORG_AUDIT_ADMIN_DENIED',
      reason: verdict.reason,
      rule_id: verdict.rule_id,
    };
  }
  return { ok: true };
}

/**
 * Admin list/query of org access audit records.
 * Unauthorized admin → deny (no rows leaked).
 */
function listOrgAccessAudit({
  projectRoot,
  adminPrincipal,
  tenantId,
  resource,
  bindingsDir,
  workDir,
  filter = {},
} = {}) {
  const gate = assertAdmin({
    tenantId,
    resource,
    principal: adminPrincipal,
    action: ADMIN_READ_ACTION,
    bindingsDir,
    projectRoot,
    workDir,
  });
  if (!gate.ok) {
    return { ok: false, code: gate.code, reason: gate.reason, rule_id: gate.rule_id, rows: [] };
  }
  let rows = readAll(projectRoot);
  if (filter.tenant_id) rows = rows.filter((r) => r.tenant_id === filter.tenant_id);
  if (filter.decision) rows = rows.filter((r) => r.decision === filter.decision);
  if (filter.principal) rows = rows.filter((r) => r.principal === filter.principal);
  if (filter.action) rows = rows.filter((r) => r.action === filter.action);
  return {
    ok: true,
    rows,
    retention: orgAccessAuditRetentionStatus(projectRoot),
  };
}

/**
 * Expire (drop) audit rows older than ttlDays. Requires org.audit.expire binding.
 */
function expireOrgAccessAudit({
  projectRoot,
  adminPrincipal,
  tenantId,
  resource,
  bindingsDir,
  workDir,
  ttlDays = DEFAULT_TTL_DAYS,
  now = Date.now(),
} = {}) {
  const gate = assertAdmin({
    tenantId,
    resource,
    principal: adminPrincipal,
    action: ADMIN_EXPIRE_ACTION,
    bindingsDir,
    projectRoot,
    workDir,
  });
  if (!gate.ok) {
    return { ok: false, code: gate.code, reason: gate.reason, rule_id: gate.rule_id, removed: 0 };
  }
  const cutoff = now - Number(ttlDays) * 86400000;
  const rows = readAll(projectRoot);
  const keep = [];
  let removed = 0;
  for (const r of rows) {
    const t = Date.parse(r.at || '');
    if (Number.isFinite(t) && t < cutoff) {
      removed += 1;
      continue;
    }
    keep.push(r);
  }
  const file = auditPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : ''));
  return {
    ok: true,
    removed,
    remaining: keep.length,
    ttl_days: Number(ttlDays),
    retention: orgAccessAuditRetentionStatus(projectRoot, { ttlDays, now }),
  };
}

module.exports = {
  AUDIT_REL,
  DEFAULT_TTL_DAYS,
  ADMIN_READ_ACTION,
  ADMIN_EXPIRE_ACTION,
  auditPath,
  appendOrgAccessAudit,
  orgAccessAuditRetentionStatus,
  listOrgAccessAudit,
  expireOrgAccessAudit,
};
