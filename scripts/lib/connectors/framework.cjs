'use strict';

/**
 * AE-040a — Connector framework: vault seam, least privilege, failure isolation,
 * and org/tenant boundary checks. Fixture connectors only (PD-58 / ADR-017 A7).
 *
 * Credentials are never taken from caller grants or input. Failures in one
 * tenant must not leak into another tenant's result or into a public memory sink.
 */

const { checkOrgAccess } = require('../memory/org-access.cjs');
const { createInMemoryVault, SECRET_FIELD_NAMES } = require('./vault.cjs');

// Local copies of grant/credential rejection keys so this service module does
// not require scripts/lib/tools (runtime) — ADR-016 forbids service→runtime.
const CALLER_GRANT_KEYS = ['authorized', 'permissions', 'grants', 'authorization'];
const CALLER_CREDENTIAL_KEYS = [
  'token',
  'api_key',
  'apikey',
  'password',
  'passwd',
  'secret',
  'credentials',
  'credential',
  'private_key',
  'access_token',
  'refresh_token',
];

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function callerGrantInjection(value) {
  if (!value || typeof value !== 'object') return null;
  for (const key of CALLER_GRANT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return key;
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function callerCredentialInjection(value) {
  if (!value || typeof value !== 'object') return null;
  for (const key of CALLER_CREDENTIAL_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return key;
  }
  for (const key of Object.keys(value)) {
    if (SECRET_FIELD_NAMES.has(key) || SECRET_FIELD_NAMES.has(key.toLowerCase())) {
      return key;
    }
  }
  return null;
}

/**
 * @param {{
 *   vault?: ReturnType<typeof createInMemoryVault>,
 *   connectors?: Map<string, object>|Record<string, object>,
 *   publicMemorySink?: { writes: unknown[] },
 * }} [opts]
 */
function createConnectorRuntime(opts = {}) {
  const vault = opts.vault || createInMemoryVault();
  /** @type {Map<string, object>} */
  const registry = new Map();
  if (opts.connectors instanceof Map) {
    for (const [id, c] of opts.connectors) registry.set(id, c);
  } else if (opts.connectors && typeof opts.connectors === 'object') {
    for (const [id, c] of Object.entries(opts.connectors)) registry.set(id, c);
  }
  const publicMemorySink = opts.publicMemorySink || { writes: [] };

  function register(connector) {
    if (!connector || !connector.id) throw new Error('connector.id required');
    registry.set(String(connector.id), connector);
  }

  /**
   * @param {{
   *   connector_id: string,
   *   tenant_id: string,
   *   org_id?: string|null,
   *   resource?: { tenant_id: string, org_id: string|null, type?: string, id?: string },
   *   action?: string,
   *   input?: object,
   *   authorized?: Iterable<string>|Set<string>,
   * }} request
   */
  async function invoke(request) {
    const logSafe = (value) => vault.redactForLog(value);
    const connectorId = String(request && request.connector_id != null ? request.connector_id : '').trim();
    const tenantId = String(request && request.tenant_id != null ? request.tenant_id : '').trim();
    const orgId = request && request.org_id != null ? String(request.org_id).trim() : '';
    const action = String(request && request.action != null ? request.action : 'read').trim() || 'read';
    const input = (request && request.input && typeof request.input === 'object') ? request.input : {};

    try {
      if (!connectorId) {
        return failClosed('MISSING_CONNECTOR_ID', 'connector_id required', logSafe);
      }
      if (!tenantId) {
        return failClosed('MISSING_TENANT_ID', 'tenant_id required', logSafe);
      }

      const grantKey = callerGrantInjection(input);
      if (grantKey) {
        return failClosed(
          'CALLER_GRANT_REJECTED',
          `caller-supplied ${grantKey} is not accepted; grants come only from the policy engine`,
          logSafe,
        );
      }
      const credKey = callerCredentialInjection(input);
      if (credKey) {
        return failClosed(
          'CALLER_CREDENTIAL_REJECTED',
          `caller-supplied ${credKey} is not accepted; credentials come only from the vault`,
          logSafe,
        );
      }

      const connector = registry.get(connectorId);
      if (!connector) {
        return failClosed('UNKNOWN_CONNECTOR', `unknown connector: ${connectorId}`, logSafe);
      }

      // Least privilege: required permissions must be present in authorized set
      // supplied by the runtime/PDP path — never from caller input.
      const authorized = toAuthSet(request.authorized);
      const required = Array.isArray(connector.required_permissions)
        ? connector.required_permissions
        : [];
      for (const perm of required) {
        if (!authorized.has(perm)) {
          return failClosed(
            'PERMISSION_DENIED',
            `missing required permission: ${perm}`,
            logSafe,
            { permission: perm },
          );
        }
      }

      // Org/tenant boundary when a resource binding is provided.
      if (request.resource) {
        const access = checkOrgAccess(
          { tenant_id: tenantId, org_id: orgId || null },
          request.resource,
          action === 'write' ? 'write' : 'read',
        );
        if (!access.allowed) {
          return failClosed(access.code || 'ORG_ACCESS_DENIED', access.reason, logSafe);
        }
      }

      const vaultEntry = vault.resolve(tenantId, connectorId);
      if (!vaultEntry) {
        // Isolated failure — do not crash the process; do not touch public memory.
        return failClosed(
          'CREDENTIAL_MISSING',
          `credential missing for connector ${connectorId} in tenant ${tenantId}`,
          logSafe,
        );
      }

      let raw;
      try {
        raw = await connector.execute({
          tenant_id: tenantId,
          org_id: orgId || null,
          action,
          input,
          // Pass secret to the connector only; never attach to the returned envelope.
          credential: { secret: vaultEntry.secret, permissions: vaultEntry.permissions },
        });
      } catch (err) {
        // Failure isolation: redact, drop leak/details, never write public memory.
        const code = (err && err.code) || 'CONNECTOR_FAILURE';
        const message = String((err && err.message) || 'connector failure');
        return failClosed(code, message, logSafe, {
          connector_id: connectorId,
          tenant_id: tenantId,
        });
      }

      const safeResult = logSafe({
        ok: true,
        connector_id: connectorId,
        tenant_id: tenantId,
        org_id: orgId || null,
        action,
        data: raw && raw.data !== undefined ? raw.data : raw,
      });
      // Never put connector results into a public memory sink from the framework.
      return safeResult;
    } catch (err) {
      // Absolute fail-closed: unexpected framework errors stay isolated.
      return failClosed(
        (err && err.code) || 'CONNECTOR_RUNTIME_ERROR',
        String((err && err.message) || 'connector runtime error'),
        logSafe,
      );
    }
  }

  function failClosed(code, message, logSafe, extra = {}) {
    // Public memory must stay untouched on connector failures.
    void publicMemorySink;
    return logSafe({
      ok: false,
      error: {
        code,
        message,
        ...extra,
      },
    });
  }

  return {
    vault,
    register,
    invoke,
    publicMemorySink,
    listConnectors() {
      return [...registry.keys()].sort();
    },
  };
}

function toAuthSet(authorized) {
  if (!authorized) return new Set();
  if (authorized instanceof Set) return authorized;
  if (Array.isArray(authorized)) return new Set(authorized.map(String));
  if (typeof authorized[Symbol.iterator] === 'function') {
    return new Set([...authorized].map(String));
  }
  return new Set();
}

module.exports = {
  CALLER_CREDENTIAL_KEYS,
  callerCredentialInjection,
  createConnectorRuntime,
  createInMemoryVault,
};
