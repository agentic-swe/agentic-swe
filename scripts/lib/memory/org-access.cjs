'use strict';

/**
 * AE-036b — Organization-scoped access: same-org allow; cross-org / cross-tenant deny.
 * Fail closed when actor or resource binding is missing/blank. Refs ADR-017 A1; PD-53.
 */

const ACTIONS = Object.freeze(['read', 'write']);

/**
 * @typedef {{ tenant_id: string, org_id: string, actor_id?: string }} AccessPrincipal
 * @typedef {{ tenant_id: string, org_id: string|null, id?: string, type?: string }} AccessResource
 */

/**
 * Normalize a non-empty id; blank → null.
 * @param {unknown} v
 * @returns {string|null}
 */
function nonEmpty(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * @param {unknown} action
 * @returns {'read'|'write'}
 */
function assertKnownAction(action) {
  const key = String(action == null ? '' : action).trim();
  if (!ACTIONS.includes(key)) {
    const err = new Error(`unknown access action: ${key || '(empty)'}`);
    err.code = 'UNKNOWN_ACCESS_ACTION';
    err.path = 'action';
    throw err;
  }
  return /** @type {'read'|'write'} */ (key);
}

/**
 * Evaluate org/tenant access without throwing.
 * @param {AccessPrincipal|null|undefined} principal
 * @param {AccessResource|null|undefined} resource
 * @param {'read'|'write'|string} action
 * @returns {{ allowed: boolean, reason: string, code: string }}
 */
function checkOrgAccess(principal, resource, action) {
  assertKnownAction(action);

  if (principal == null || typeof principal !== 'object') {
    return {
      allowed: false,
      reason: 'principal missing',
      code: 'MISSING_PRINCIPAL',
    };
  }
  if (resource == null || typeof resource !== 'object') {
    return {
      allowed: false,
      reason: 'resource missing',
      code: 'MISSING_RESOURCE',
    };
  }

  const pTenant = nonEmpty(principal.tenant_id);
  const pOrg = nonEmpty(principal.org_id);
  const rTenant = nonEmpty(resource.tenant_id);
  // Organization resources may use their own id as org_id when org_id is null.
  let rOrg = nonEmpty(resource.org_id);
  if (!rOrg && resource.type === 'organization' && nonEmpty(resource.id)) {
    rOrg = nonEmpty(resource.id);
  }

  if (!pTenant) {
    return {
      allowed: false,
      reason: 'principal tenant_id required',
      code: 'MISSING_TENANT_BINDING',
    };
  }
  if (!pOrg) {
    return {
      allowed: false,
      reason: 'principal org_id required',
      code: 'MISSING_ORG_BINDING',
    };
  }
  if (!rTenant) {
    return {
      allowed: false,
      reason: 'resource tenant_id required',
      code: 'MISSING_TENANT_BINDING',
    };
  }
  if (!rOrg) {
    return {
      allowed: false,
      reason: 'resource org_id required',
      code: 'MISSING_ORG_BINDING',
    };
  }

  if (pTenant !== rTenant) {
    return {
      allowed: false,
      reason: `cross-tenant ${action} denied: principal=${pTenant} resource=${rTenant}`,
      code: 'CROSS_TENANT_DENIED',
    };
  }
  if (pOrg !== rOrg) {
    return {
      allowed: false,
      reason: `cross-org ${action} denied: principal=${pOrg} resource=${rOrg}`,
      code: 'CROSS_ORG_DENIED',
    };
  }

  return {
    allowed: true,
    reason: `same-org ${action} allowed`,
    code: 'ALLOW',
  };
}

/**
 * Fail-closed assert for org/tenant access.
 * @param {AccessPrincipal} principal
 * @param {AccessResource} resource
 * @param {'read'|'write'|string} action
 */
function assertOrgAccess(principal, resource, action) {
  const result = checkOrgAccess(principal, resource, action);
  if (!result.allowed) {
    const err = new Error(result.reason);
    err.code = result.code;
    err.path = 'access';
    throw err;
  }
  return result;
}

module.exports = {
  ACTIONS,
  checkOrgAccess,
  assertOrgAccess,
};
