'use strict';

/**
 * AE-040a — Credential vault seam for the connector framework.
 *
 * Credentials are never stored in the git repo, never taken from caller
 * grants/input, and never returned in log-shaped payloads. This module is an
 * in-process seam for fixture connectors only (PD-58: no live SaaS).
 */

const { redactDeep, redactSecrets } = require('../shared/redact.cjs');

/**
 * @typedef {{ tenant_id: string, connector_id: string, secret: string, permissions?: string[] }} VaultEntry
 */

/**
 * Create an in-memory vault. Secrets stay in process memory only.
 * @returns {{
 *   put: (entry: VaultEntry) => void,
 *   resolve: (tenantId: string, connectorId: string) => VaultEntry|null,
 *   has: (tenantId: string, connectorId: string) => boolean,
 *   clearTenant: (tenantId: string) => void,
 *   redactForLog: (value: unknown) => unknown,
 * }}
 */
function createInMemoryVault() {
  /** @type {Map<string, VaultEntry>} */
  const store = new Map();

  function key(tenantId, connectorId) {
    const t = String(tenantId == null ? '' : tenantId).trim();
    const c = String(connectorId == null ? '' : connectorId).trim();
    if (!t || !c) {
      const err = new Error('vault requires tenant_id and connector_id');
      err.code = 'VAULT_KEY_REQUIRED';
      throw err;
    }
    if (t.includes('..') || t.includes('/') || t.includes('\\') || t.includes('\0')) {
      const err = new Error(`invalid tenant_id for vault: ${t}`);
      err.code = 'INVALID_TENANT_ID';
      throw err;
    }
    return `${t}::${c}`;
  }

  return {
    put(entry) {
      if (!entry || typeof entry !== 'object') {
        const err = new Error('vault entry required');
        err.code = 'VAULT_ENTRY_REQUIRED';
        throw err;
      }
      const secret = entry.secret == null ? '' : String(entry.secret);
      if (!secret) {
        const err = new Error('vault secret required');
        err.code = 'VAULT_SECRET_REQUIRED';
        throw err;
      }
      const k = key(entry.tenant_id, entry.connector_id);
      store.set(k, {
        tenant_id: String(entry.tenant_id).trim(),
        connector_id: String(entry.connector_id).trim(),
        secret,
        permissions: Array.isArray(entry.permissions) ? [...entry.permissions] : [],
      });
    },

    resolve(tenantId, connectorId) {
      const k = key(tenantId, connectorId);
      const hit = store.get(k);
      return hit ? { ...hit, permissions: [...(hit.permissions || [])] } : null;
    },

    has(tenantId, connectorId) {
      try {
        return store.has(key(tenantId, connectorId));
      } catch {
        return false;
      }
    },

    clearTenant(tenantId) {
      const t = String(tenantId == null ? '' : tenantId).trim();
      for (const k of [...store.keys()]) {
        if (k.startsWith(`${t}::`)) store.delete(k);
      }
    },

    /**
     * Safe for journals / error surfaces: never emit raw secrets.
     * Also strips known secret field names entirely.
     */
    redactForLog(value) {
      const scrubbed = scrubSecretFields(value);
      return redactDeep(scrubbed);
    },
  };
}

const SECRET_FIELD_NAMES = new Set([
  'secret',
  'token',
  'api_key',
  'apikey',
  'password',
  'passwd',
  'credentials',
  'credential',
  'private_key',
  'privateKey',
  'access_token',
  'refresh_token',
  'authorization',
]);

function scrubSecretFields(value) {
  if (typeof value === 'string') return redactSecrets(value).redacted;
  if (Array.isArray(value)) return value.map((item) => scrubSecretFields(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_FIELD_NAMES.has(k) || SECRET_FIELD_NAMES.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = scrubSecretFields(v);
      }
    }
    return out;
  }
  return value;
}

module.exports = {
  createInMemoryVault,
  SECRET_FIELD_NAMES,
  scrubSecretFields,
};
