'use strict';

/**
 * AE-039d / ADR-017: integration permission grants from org RBAC bindings only.
 *
 * Caller-supplied authorized/grants/permissions never elevate. Grants are the
 * `actions` list on a matching AE-039a disk binding for
 * (tenant_id, org_id|team_id|project_id, principal).
 *
 * Layer: policy (core).
 */

const {
  loadBindings,
  resolveBindingsDir,
  extractOrgScopedContext,
} = require('./org-rbac.cjs');

/**
 * Resolve the set of integration permissions granted by disk bindings.
 * Never reads caller-supplied authorized / grants arrays.
 *
 * @param {{
 *   tenantId?: string|null,
 *   orgId?: string|null,
 *   teamId?: string|null,
 *   projectId?: string|null,
 *   principal?: string|null,
 *   bindingsDir?: string|null,
 *   projectRoot?: string|null,
 *   workDir?: string|null,
 * }} params
 * @returns {{ ok: true, grants: Set<string> } | { ok: false, reason: string, grants: Set<string> }}
 */
function resolveIntegrationGrants(params = {}) {
  const grants = new Set();
  // Intentionally ignore any caller grant fields that may sit on params.
  const ctx = extractOrgScopedContext({
    tenant_id: params.tenantId,
    org_id: params.orgId,
    team_id: params.teamId,
    project_id: params.projectId,
    principal: params.principal,
    action: 'integration.resolve', // placeholder; we collect all actions from matches
  });
  if (!ctx || !ctx.principal) {
    return {
      ok: false,
      reason:
        'integration grants require tenant_id, org/team/project resource, and principal (from org RBAC bindings; never caller-supplied)',
      grants,
    };
  }

  const loaded = loadBindings(
    resolveBindingsDir({
      bindingsDir: params.bindingsDir,
      projectRoot: params.projectRoot,
      workDir: params.workDir,
    })
  );
  if (!loaded.bindings.length) {
    return {
      ok: false,
      reason: loaded.errors.length
        ? `no valid org RBAC bindings (${loaded.errors[0]})`
        : 'no org RBAC bindings on disk for integration grants',
      grants,
    };
  }

  for (const b of loaded.bindings) {
    if (!b || b.tenant_id !== ctx.tenantId) continue;
    if (!b.resource || b.resource.type !== ctx.resource.type || b.resource.id !== ctx.resource.id) {
      continue;
    }
    if (b.principal !== ctx.principal) continue;
    for (const action of b.actions || []) {
      if (typeof action === 'string' && action.trim()) grants.add(action.trim());
    }
  }

  if (grants.size === 0) {
    return {
      ok: false,
      reason: `no integration grants bound for (${ctx.tenantId}, ${ctx.resource.type}:${ctx.resource.id}, ${ctx.principal})`,
      grants,
    };
  }
  return { ok: true, grants };
}

/**
 * True when a request object tries to supply integration grants itself.
 * @param {object} request
 * @returns {string|null} offending key
 */
function callerIntegrationGrantKey(request) {
  if (!request || typeof request !== 'object') return null;
  for (const key of ['authorized', 'grants', 'permissions', 'authorization', 'integration_grants']) {
    if (Object.prototype.hasOwnProperty.call(request, key)) return key;
  }
  return null;
}

module.exports = {
  resolveIntegrationGrants,
  callerIntegrationGrantKey,
};
