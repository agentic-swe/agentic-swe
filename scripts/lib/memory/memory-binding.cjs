'use strict';

/**
 * AE-036c — tenant/org binding for MemoryService + skill memory lookup.
 * Shared org memory (pilot tenant_id) is invisible without an explicit tenant_id.
 * PD-46 local/personal labels remain visible without binding. Refs ADR-017 A2/A3.
 */

const { resolvePilotTenantId, loadTenantConfig } = require('./tenant-config.cjs');

/** Labels that mean local-private (not pilot-shared). */
const LOCAL_TENANT_LABELS = new Set(['personal', 'local']);

/**
 * @param {unknown} v
 * @returns {string|null}
 */
function nonEmpty(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Whether a tenant_id marks pilot-shared org memory (vs PD-46 local-private).
 * @param {string|null|undefined} tenantId
 */
function isSharedOrgTenant(tenantId) {
  const t = nonEmpty(tenantId);
  if (!t) return false;
  return !LOCAL_TENANT_LABELS.has(t);
}

/**
 * Resolve the caller's memory binding.
 * Pilot tenant comes from human-written config; callers cannot assert a broader tenant.
 * @param {string} projectRoot
 * @param {{ tenant_id?: string|null, org_id?: string|null }} [request]
 * @returns {{ tenant_id: string|null, org_id: string|null, pilot_tenant_id: string|null }}
 */
function resolveMemoryBinding(projectRoot, request = {}) {
  const pilot = resolvePilotTenantId(projectRoot, {
    callerTenantId: request.tenant_id,
  });
  const reqTenant = nonEmpty(request.tenant_id);
  const orgId = nonEmpty(request.org_id);

  // Prefer explicit request tenant when it matches pilot (or no pilot yet).
  let tenantId = null;
  if (reqTenant) {
    tenantId = reqTenant;
  } else if (pilot) {
    // Opt-in install has a pilot, but caller omitted tenant_id → unbound for shared reads.
    tenantId = null;
  }

  return {
    tenant_id: tenantId,
    org_id: orgId,
    pilot_tenant_id: pilot,
  };
}

/**
 * Decide if a memory record is visible under the binding.
 * Shared org memory requires matching tenant_id; missing binding hides it.
 * @param {object} record
 * @param {{ tenant_id: string|null, org_id: string|null }} binding
 */
function recordVisibleUnderBinding(record, binding) {
  if (!record || typeof record !== 'object') return false;
  const scope = String(record.scope || '').trim();
  const recTenant = nonEmpty(record.tenant_id);
  const recOrg = nonEmpty(record.org_id);

  // Personal skill memory stays user-labeled; never auto-joins org share.
  if (scope === 'skill') {
    return true;
  }

  if (scope !== 'organizational') {
    return true;
  }

  // PD-46 local-private org rows stay visible without tenant binding.
  if (!isSharedOrgTenant(recTenant)) {
    return true;
  }

  // Shared org memory: require explicit matching tenant_id.
  const bindTenant = binding && nonEmpty(binding.tenant_id);
  if (!bindTenant) {
    return false;
  }
  if (recTenant !== bindTenant) {
    return false;
  }

  // When both sides stamp org_id, they must match.
  const bindOrg = binding && nonEmpty(binding.org_id);
  if (recOrg && bindOrg && recOrg !== bindOrg) {
    return false;
  }
  if (recOrg && !bindOrg) {
    // Org-stamped shared row requires org binding.
    return false;
  }

  return true;
}

/**
 * Filter a list of memory records by binding.
 * @param {object[]} records
 * @param {{ tenant_id: string|null, org_id: string|null }} binding
 */
function filterRecordsForBinding(records, binding) {
  if (!Array.isArray(records)) return [];
  return records.filter((r) => recordVisibleUnderBinding(r, binding || {}));
}

/**
 * Bind tenant_id on organizational write when pilot share path is used.
 * Callers cannot widen beyond the pilot config tenant.
 * @param {string} projectRoot
 * @param {object} input normalizeWriteRecord input
 */
function bindWriteTenant(projectRoot, input) {
  const scope = String((input && input.scope) || '').trim();
  const out = { ...(input || {}) };
  if (scope !== 'organizational') {
    return out;
  }

  const cfg = loadTenantConfig(projectRoot);
  const requested = nonEmpty(out.tenant_id);

  if (cfg && requested && requested !== cfg.tenant_id && isSharedOrgTenant(requested)) {
    const err = new Error(
      `caller tenant_id ${requested} does not match pilot config ${cfg.tenant_id}`
    );
    err.code = 'TENANT_MISMATCH';
    err.path = 'tenant_id';
    throw err;
  }

  // AE-038a: share stamping / opt-in gate lives in org-share.prepareOrgShareWrite.
  // Here only enforce tenant mismatch against pilot config for explicit shared ids.
  if (out.org_id != null) {
    out.org_id = nonEmpty(out.org_id);
  }

  return out;
}

module.exports = {
  LOCAL_TENANT_LABELS,
  isSharedOrgTenant,
  resolveMemoryBinding,
  recordVisibleUnderBinding,
  filterRecordsForBinding,
  bindWriteTenant,
};
