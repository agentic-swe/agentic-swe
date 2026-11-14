'use strict';

/**
 * AE-036b — Disk-backed org resource store with per-tenant isolation.
 * Each tenant gets its own directory under the store root; cross-tenant
 * path resolution is denied. Refs ADR-017 A1 / A2.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  validateOrgResource,
  indexKnownOwners,
  RESOURCE_TYPES,
} = require('./org-ownership.cjs');
const { assertOrgAccess, checkOrgAccess } = require('./org-access.cjs');

/**
 * @param {string} storeRoot
 * @param {string} tenantId
 * @returns {string}
 */
function tenantDir(storeRoot, tenantId) {
  const tid = String(tenantId == null ? '' : tenantId).trim();
  if (!tid) {
    const err = new Error('tenant_id required for store path');
    err.code = 'MISSING_TENANT_ID';
    throw err;
  }
  // Reject path traversal in tenant ids.
  if (tid.includes('..') || tid.includes('/') || tid.includes('\\') || tid.includes('\0')) {
    const err = new Error(`invalid tenant_id for store path: ${tid}`);
    err.code = 'INVALID_TENANT_ID';
    throw err;
  }
  return path.join(path.resolve(storeRoot), 'tenants', tid);
}

/**
 * @param {string} storeRoot
 * @param {string} tenantId
 */
function ensureTenantDir(storeRoot, tenantId) {
  const dir = tenantDir(storeRoot, tenantId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Safe file name for a resource id.
 * @param {string} id
 */
function resourceFileName(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9._:-]/g, '_');
  if (!safe) {
    const err = new Error('resource id empty after sanitize');
    err.code = 'INVALID_RESOURCE_ID';
    throw err;
  }
  return `${safe}.json`;
}

/**
 * Create an in-memory + disk org store rooted at storeRoot.
 * @param {{ storeRoot: string, knownOwners?: Iterable<{kind:string,id:string}> }} opts
 */
function createOrgStore(opts) {
  const storeRoot = path.resolve(opts.storeRoot);
  const knownOwners = opts.knownOwners || [];

  /**
   * @param {unknown} resource
   * @param {{ principal: { tenant_id: string, org_id: string, actor_id?: string } }} ctx
   */
  function writeResource(resource, ctx) {
    const parsed = validateOrgResource(resource, { knownOwners });
    assertOrgAccess(ctx.principal, parsed, 'write');
    const dir = ensureTenantDir(storeRoot, parsed.tenant_id);
    // Defend against writing a resource whose tenant_id escapes the principal's tenant.
    if (parsed.tenant_id !== ctx.principal.tenant_id) {
      const err = new Error('cross-tenant write denied at store boundary');
      err.code = 'CROSS_TENANT_DENIED';
      throw err;
    }
    const filePath = path.join(dir, resourceFileName(parsed.id));
    fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    return parsed;
  }

  /**
   * @param {{ tenant_id: string, id: string }} key
   * @param {{ principal: { tenant_id: string, org_id: string, actor_id?: string } }} ctx
   */
  function readResource(key, ctx) {
    const tenantId = String(key.tenant_id == null ? '' : key.tenant_id).trim();
    const id = String(key.id == null ? '' : key.id).trim();
    if (!tenantId || !id) {
      const err = new Error('tenant_id and id required to read');
      err.code = 'MISSING_RESOURCE_KEY';
      throw err;
    }
    if (tenantId !== ctx.principal.tenant_id) {
      const err = new Error(
        `cross-tenant read denied: principal=${ctx.principal.tenant_id} resource=${tenantId}`
      );
      err.code = 'CROSS_TENANT_DENIED';
      throw err;
    }
    const filePath = path.join(tenantDir(storeRoot, tenantId), resourceFileName(id));
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
        const missing = new Error(`org resource not found: ${id}`);
        missing.code = 'RESOURCE_NOT_FOUND';
        throw missing;
      }
      throw err;
    }
    const parsed = validateOrgResource(JSON.parse(raw), { knownOwners });
    assertOrgAccess(ctx.principal, parsed, 'read');
    return parsed;
  }

  /**
   * List resources for a tenant (principal must match tenant).
   * @param {string} tenantId
   * @param {{ principal: { tenant_id: string, org_id: string } }} ctx
   */
  function listResources(tenantId, ctx) {
    const tid = String(tenantId == null ? '' : tenantId).trim();
    if (tid !== ctx.principal.tenant_id) {
      const err = new Error(
        `cross-tenant list denied: principal=${ctx.principal.tenant_id} resource=${tid}`
      );
      err.code = 'CROSS_TENANT_DENIED';
      throw err;
    }
    const dir = tenantDir(storeRoot, tid);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (err) {
      if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
        return [];
      }
      throw err;
    }
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const parsed = validateOrgResource(
        JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')),
        { knownOwners }
      );
      const access = checkOrgAccess(ctx.principal, parsed, 'read');
      if (access.allowed) out.push(parsed);
    }
    return out;
  }

  return {
    storeRoot,
    tenantDir: (tenantId) => tenantDir(storeRoot, tenantId),
    writeResource,
    readResource,
    listResources,
    RESOURCE_TYPES,
  };
}

module.exports = {
  tenantDir,
  ensureTenantDir,
  createOrgStore,
};
