'use strict';

/**
 * AE-038a — Org/team memory share inside one pilot tenant (PD-53 / ADR-017 A1/A8).
 * Explicit opt-in via share_org_memory in tenant.json. Private never becomes public.
 * Absent opt-in → PD-46 local-private. Refs ADR-017.
 */

const { loadTenantConfig } = require('./tenant-config.cjs');
const { isSharedOrgTenant } = require('./memory-binding.cjs');

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
 * Whether the install opted into org/team share inside the pilot tenant.
 * @param {string} projectRoot
 * @returns {{ enabled: boolean, tenant_id: string|null, reason: string }}
 */
function orgShareStatus(projectRoot) {
  const cfg = loadTenantConfig(projectRoot);
  if (!cfg) {
    return {
      enabled: false,
      tenant_id: null,
      reason: 'no tenant config (PD-46 local-private)',
    };
  }
  if (cfg.share_org_memory !== true) {
    return {
      enabled: false,
      tenant_id: cfg.tenant_id,
      reason: 'share_org_memory not opted in',
    };
  }
  return {
    enabled: true,
    tenant_id: cfg.tenant_id,
    reason: 'share_org_memory enabled for pilot tenant',
  };
}

/**
 * Assert org/team share is allowed for this install.
 * @param {string} projectRoot
 */
function assertOrgShareEnabled(projectRoot) {
  const status = orgShareStatus(projectRoot);
  if (!status.enabled) {
    const err = new Error(`org/team memory share denied: ${status.reason}`);
    err.code = 'ORG_SHARE_NOT_ENABLED';
    err.path = 'share_org_memory';
    throw err;
  }
  return status;
}

/**
 * Prepare an organizational write under the share rules.
 * - Without opt-in: shared tenant_id / share:true / team_id share path fails closed.
 * - With opt-in: stamp pilot tenant_id; visibility must stay private|local (never public).
 * - Enabling share never rewrites existing private→public (write path only stamps new rows).
 *
 * @param {string} projectRoot
 * @param {object} input
 * @returns {object}
 */
function prepareOrgShareWrite(projectRoot, input) {
  const scope = String((input && input.scope) || '').trim();
  const out = { ...(input || {}) };
  if (scope !== 'organizational') {
    return out;
  }

  const status = orgShareStatus(projectRoot);
  const wantsShare =
    out.share === true ||
    nonEmpty(out.team_id) != null ||
    (nonEmpty(out.tenant_id) != null && isSharedOrgTenant(out.tenant_id));

  if (wantsShare && !status.enabled) {
    const err = new Error(
      `org/team shared memory write requires share_org_memory opt-in (${status.reason})`
    );
    err.code = 'ORG_SHARE_NOT_ENABLED';
    err.path = 'share_org_memory';
    throw err;
  }

  if (!wantsShare) {
    // Stay local-private: do not stamp pilot tenant.
    if (out.share === false || out.share == null) {
      // leave tenant_id to resolveTenantLabel → local when absent
      delete out.share;
    }
    return out;
  }

  // Callers cannot assert a different/broader tenant than the pilot.
  const requested = nonEmpty(out.tenant_id);
  if (
    requested &&
    status.tenant_id &&
    requested !== status.tenant_id &&
    isSharedOrgTenant(requested)
  ) {
    const err = new Error(
      `caller tenant_id ${requested} does not match pilot config ${status.tenant_id}`
    );
    err.code = 'TENANT_MISMATCH';
    err.path = 'tenant_id';
    throw err;
  }

  // Share path inside the one pilot tenant only.
  out.tenant_id = status.tenant_id;
  delete out.share;

  const visibility =
    out.visibility != null && String(out.visibility).trim() !== ''
      ? String(out.visibility).trim()
      : 'private';
  if (visibility === 'public') {
    const err = new Error(
      'organizational shared memory cannot be public (private≠public; AE-038b auth_ref path later)'
    );
    err.code = 'ORG_MEMORY_PUBLIC_FORBIDDEN';
    err.path = 'visibility';
    throw err;
  }
  out.visibility = visibility;

  if (out.team_id != null) {
    const teamId = nonEmpty(out.team_id);
    if (!teamId) {
      const err = new Error('team_id blank');
      err.code = 'MISSING_TEAM_ID';
      err.path = 'team_id';
      throw err;
    }
    out.team_id = teamId;
  }

  if (out.org_id != null) {
    out.org_id = nonEmpty(out.org_id);
  }

  return out;
}

/**
 * Migration helper: enabling share must not flip visibility on existing records.
 * Returns a copy; never mutates. public stays forbidden to invent.
 * @param {object} record
 * @returns {object}
 */
function migrateRecordOnShareEnable(record) {
  if (!record || typeof record !== 'object') {
    const err = new Error('record required');
    err.code = 'INVALID_RECORD';
    throw err;
  }
  const next = { ...record };
  // Explicit non-widening: visibility unchanged; never coerce private→public.
  if (next.visibility === 'public' && next.scope === 'organizational') {
    // Keep as-is for audit; writers still forbid new public org rows.
    return next;
  }
  return next;
}

module.exports = {
  orgShareStatus,
  assertOrgShareEnabled,
  prepareOrgShareWrite,
  migrateRecordOnShareEnable,
};
