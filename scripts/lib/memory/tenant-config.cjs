'use strict';

/**
 * AE-036a / ADR-017 C1 — pilot tenant_id from human-written project config.
 * Never inferred from caller input, git remote, or org slug.
 * Absent opt-in → null (PD-46 local-private default remains).
 */

const fs = require('node:fs');
const path = require('node:path');

const TENANT_CONFIG_REL = path.join('.agentic-swe', 'tenant.json');

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function tenantConfigPath(projectRoot) {
  return path.join(path.resolve(projectRoot), TENANT_CONFIG_REL);
}

/**
 * Read pilot tenant_id from `.agentic-swe/tenant.json` if present.
 * @param {string} projectRoot
 * @returns {{ tenant_id: string, share_org_memory?: boolean }|null}
 */
function loadTenantConfig(projectRoot) {
  const filePath = tenantConfigPath(projectRoot);
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err = new Error(`invalid tenant config JSON: ${filePath}`);
    err.code = 'INVALID_TENANT_CONFIG';
    err.path = filePath;
    throw err;
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error(`tenant config must be an object: ${filePath}`);
    err.code = 'INVALID_TENANT_CONFIG';
    err.path = filePath;
    throw err;
  }
  const tenantId = String(
    /** @type {Record<string, unknown>} */ (parsed).tenant_id == null
      ? ''
      : /** @type {Record<string, unknown>} */ (parsed).tenant_id
  ).trim();
  if (!tenantId) {
    const err = new Error(`tenant_id required in ${filePath}`);
    err.code = 'MISSING_TENANT_ID';
    err.path = 'tenant_id';
    throw err;
  }
  const share = /** @type {Record<string, unknown>} */ (parsed).share_org_memory;
  const out = { tenant_id: tenantId };
  if (share === true) {
    out.share_org_memory = true;
  } else if (share === false) {
    out.share_org_memory = false;
  }
  return out;
}

/**
 * Resolve the install's pilot tenant_id, or null when no opt-in config exists.
 * Callers cannot override with a broader tenant via input.
 * @param {string} projectRoot
 * @param {{ callerTenantId?: string|null }} [opts]
 * @returns {string|null}
 */
function resolvePilotTenantId(projectRoot, opts = {}) {
  const cfg = loadTenantConfig(projectRoot);
  if (!cfg) {
    return null;
  }
  // Callers cannot assert a broader/different tenant than the human-written config.
  if (
    opts.callerTenantId != null &&
    String(opts.callerTenantId).trim() !== '' &&
    String(opts.callerTenantId).trim() !== cfg.tenant_id
  ) {
    const err = new Error(
      `caller tenant_id ${String(opts.callerTenantId).trim()} does not match pilot config ${cfg.tenant_id}`
    );
    err.code = 'TENANT_MISMATCH';
    err.path = 'tenant_id';
    throw err;
  }
  return cfg.tenant_id;
}

module.exports = {
  TENANT_CONFIG_REL,
  tenantConfigPath,
  loadTenantConfig,
  resolvePilotTenantId,
};
