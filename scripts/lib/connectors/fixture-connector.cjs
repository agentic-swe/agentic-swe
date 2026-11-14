'use strict';

/**
 * AE-040a — In-process fixture connector only (PD-58).
 * No live network, no API keys, no GitHub App.
 */

/**
 * @typedef {{
 *   id: string,
 *   required_permissions: string[],
 *   data_by_tenant: Record<string, unknown>,
 *   fail_tenants?: Record<string, { code?: string, message?: string, leak?: unknown }>,
 * }} FixtureSpec
 */

/**
 * @param {FixtureSpec} spec
 */
function createFixtureConnector(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('fixture connector spec required');
  }
  const id = String(spec.id == null ? '' : spec.id).trim();
  if (!id) throw new Error('fixture connector id required');
  const required = Array.isArray(spec.required_permissions)
    ? spec.required_permissions.map((p) => String(p))
    : [];
  const dataByTenant = spec.data_by_tenant && typeof spec.data_by_tenant === 'object'
    ? spec.data_by_tenant
    : {};
  const failTenants = spec.fail_tenants && typeof spec.fail_tenants === 'object'
    ? spec.fail_tenants
    : {};

  return {
    id,
    required_permissions: Object.freeze([...required]),
    kind: 'fixture',
    network: false,

    /**
     * @param {{
     *   tenant_id: string,
     *   org_id?: string|null,
     *   action: string,
     *   input?: object,
     *   credential?: { secret: string, permissions?: string[] }|null,
     * }} ctx
     */
    async execute(ctx) {
      const tenantId = String(ctx && ctx.tenant_id != null ? ctx.tenant_id : '').trim();
      if (!tenantId) {
        const err = new Error('fixture connector requires tenant_id');
        err.code = 'MISSING_TENANT_ID';
        throw err;
      }
      const fail = failTenants[tenantId];
      if (fail) {
        const err = new Error(fail.message || `fixture connector failure for tenant ${tenantId}`);
        err.code = fail.code || 'FIXTURE_CONNECTOR_FAILURE';
        // Deliberate poison: if a buggy connector attaches cross-tenant leak
        // material, the framework must scrub it before returning.
        if (fail.leak !== undefined) {
          err.leak = fail.leak;
          err.details = fail.leak;
        }
        throw err;
      }
      if (!Object.prototype.hasOwnProperty.call(dataByTenant, tenantId)) {
        const err = new Error(`no fixture data for tenant ${tenantId}`);
        err.code = 'FIXTURE_TENANT_MISS';
        throw err;
      }
      // Return only this tenant's data (structured clone to avoid shared refs).
      const payload = dataByTenant[tenantId];
      return {
        ok: true,
        connector_id: id,
        tenant_id: tenantId,
        org_id: ctx.org_id == null ? null : ctx.org_id,
        action: ctx.action,
        data: structuredCloneSafe(payload),
      };
    },
  };
}

function structuredCloneSafe(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

module.exports = { createFixtureConnector };
