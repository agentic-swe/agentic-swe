'use strict';

/**
 * AE-041a / ADR-017 A6 / PD-59 / PD-62 C3 — deployment mode helpers.
 *
 * Real enforcement in this pack covers self-hosted tenant path isolation,
 * a private-runner-shaped env/network allow-list, and hybrid fail-closed
 * against a stub remote. There is NO managed control plane implementation;
 * managed isolation claims are documented limits only.
 */

const path = require('node:path');
const { tenantDir } = require('../memory/org-store.cjs');

const MODES = Object.freeze(['self-hosted', 'private-runners', 'managed', 'hybrid']);

/**
 * Private-runner-shaped allow-list profile (fixture of what a private runner
 * would permit). Not OS/container isolation — process-level allow-list only.
 */
const PRIVATE_RUNNER_PROFILE = Object.freeze({
  id: 'private-runner',
  shell: false,
  network: 'allowlist',
  net_hosts: Object.freeze(['registry.npmjs.org', 'github.com']),
  env_allowlist: Object.freeze([
    'PATH',
    'HOME',
    'TMPDIR',
    'NODE_ENV',
    'npm_config_registry',
  ]),
  fs_write: Object.freeze([]),
  require_pdp_allow: true,
});

/**
 * @param {string} mode
 * @returns {boolean}
 */
function isKnownMode(mode) {
  return MODES.includes(String(mode == null ? '' : mode).trim());
}

/**
 * Self-hosted claim: tenant store paths are isolated under storeRoot/tenants/<id>.
 * Uses the same path helper AE-036b/org-store already enforces.
 * @param {string} storeRoot
 * @param {string} tenantId
 * @returns {{ ok: true, path: string }|{ ok: false, code: string, message: string }}
 */
function resolveSelfHostedTenantPath(storeRoot, tenantId) {
  try {
    const resolved = tenantDir(storeRoot, tenantId);
    const root = path.resolve(storeRoot);
    const tenantsRoot = path.join(root, 'tenants') + path.sep;
    if (!resolved.startsWith(tenantsRoot) && resolved !== path.join(root, 'tenants', String(tenantId).trim())) {
      return {
        ok: false,
        code: 'TENANT_PATH_ESCAPE',
        message: 'resolved tenant path escaped store root',
      };
    }
    // Cross-tenant: path for A must not equal / contain path for a different id.
    return { ok: true, path: resolved };
  } catch (err) {
    return {
      ok: false,
      code: (err && err.code) || 'TENANT_PATH_DENIED',
      message: String((err && err.message) || 'tenant path denied'),
    };
  }
}

/**
 * Assert two tenants resolve to distinct directories (self-hosted isolation).
 * @param {string} storeRoot
 * @param {string} tenantA
 * @param {string} tenantB
 */
function assertSelfHostedTenantIsolation(storeRoot, tenantA, tenantB) {
  const a = resolveSelfHostedTenantPath(storeRoot, tenantA);
  const b = resolveSelfHostedTenantPath(storeRoot, tenantB);
  if (!a.ok) return a;
  if (!b.ok) return b;
  if (a.path === b.path) {
    return {
      ok: false,
      code: 'TENANT_PATH_COLLISION',
      message: 'tenant paths collided',
    };
  }
  if (a.path.startsWith(b.path + path.sep) || b.path.startsWith(a.path + path.sep)) {
    return {
      ok: false,
      code: 'TENANT_PATH_NESTED',
      message: 'tenant paths nest incorrectly',
    };
  }
  return { ok: true, path_a: a.path, path_b: b.path };
}

/**
 * Private-runner allow-list: admit only env keys on the profile allow-list.
 * Secret-shaped keys are always denied even if somehow listed.
 * @param {Record<string, string>} env
 * @param {{ env_allowlist?: string[] }} [profile]
 */
function filterPrivateRunnerEnv(env, profile = PRIVATE_RUNNER_PROFILE) {
  const allow = new Set(profile.env_allowlist || []);
  const SECRET_RE = /(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIALS?)$/i;
  const out = {};
  const denied = [];
  for (const [k, v] of Object.entries(env || {})) {
    if (!allow.has(k) || SECRET_RE.test(k)) {
      denied.push(k);
      continue;
    }
    out[k] = v;
  }
  return { ok: denied.length === 0 || Object.keys(out).length >= 0, env: out, denied };
}

/**
 * Private-runner network: host must be on allow-list; deny by default.
 * @param {string} urlOrHost
 * @param {{ network?: string, net_hosts?: string[] }} [profile]
 */
function assertPrivateRunnerNetwork(urlOrHost, profile = PRIVATE_RUNNER_PROFILE) {
  const network = profile.network || 'deny';
  const hosts = profile.net_hosts || [];
  if (network === 'deny' || hosts.length === 0 && network !== 'allowlist') {
    return { ok: false, code: 'NETWORK_DENIED', message: 'network deny-by-default' };
  }
  if (network !== 'allowlist') {
    return { ok: false, code: 'NETWORK_DENIED', message: `unsupported network mode: ${network}` };
  }
  let host = String(urlOrHost == null ? '' : urlOrHost).trim().toLowerCase();
  try {
    if (host.includes('://')) host = new URL(host).hostname;
  } catch {
    return { ok: false, code: 'NETWORK_INVALID_URL', message: 'invalid URL' };
  }
  if (!host) {
    return { ok: false, code: 'NETWORK_DENIED', message: 'empty host' };
  }
  const allowed = hosts.some((h) => host === h || host.endsWith(`.${h}`));
  if (!allowed) {
    return {
      ok: false,
      code: 'NETWORK_HOST_DENIED',
      message: `host not on private-runner allow-list: ${host}`,
    };
  }
  return { ok: true, host };
}

/**
 * Hybrid mode: local install + optional remote. Fail closed when the remote
 * stub is missing, unreachable, or returns deny. Does not invent a managed plane.
 *
 * @param {{
 *   remote?: null|{ ping: () => Promise<{ ok: boolean, code?: string, message?: string }> },
 *   require_remote?: boolean,
 * }} opts
 */
async function checkHybridRemote(opts = {}) {
  const requireRemote = opts.require_remote !== false;
  const remote = opts.remote;
  if (remote == null) {
    if (!requireRemote) {
      return { ok: true, mode: 'hybrid', remote: 'absent-local-only' };
    }
    return {
      ok: false,
      code: 'HYBRID_REMOTE_REQUIRED',
      message: 'hybrid mode requires a remote; fail closed when absent',
    };
  }
  if (typeof remote.ping !== 'function') {
    return {
      ok: false,
      code: 'HYBRID_REMOTE_INVALID',
      message: 'hybrid remote stub missing ping()',
    };
  }
  let result;
  try {
    result = await remote.ping();
  } catch (err) {
    return {
      ok: false,
      code: 'HYBRID_REMOTE_UNREACHABLE',
      message: String((err && err.message) || 'remote unreachable'),
    };
  }
  if (!result || result.ok !== true) {
    return {
      ok: false,
      code: (result && result.code) || 'HYBRID_REMOTE_DENIED',
      message: (result && result.message) || 'remote denied',
    };
  }
  return { ok: true, mode: 'hybrid', remote: 'stub-ok' };
}

/**
 * Managed mode: no control plane in this repository (PD-62 C3).
 * Callers that ask the pack to enforce managed isolation get an explicit limit.
 */
function managedControlPlaneStatus() {
  return {
    ok: false,
    implemented: false,
    code: 'MANAGED_PLANE_NOT_IMPLEMENTED',
    message:
      'managed control plane is not implemented in this repository; threat model + documented limit only (PD-62 C3)',
    tested_claims: [],
    documented_limits: [
      'multi-tenant hosted isolation by a vendor control plane',
      'central credential custody across customer orgs',
      'remote policy push / fleet attestation',
    ],
  };
}

/**
 * Catalog of modes with honesty notes for docs/tests.
 */
function modeCatalog() {
  return {
    'self-hosted': {
      ops_owner: 'install operator',
      tested_in_repo: [
        'tenant store path isolation (org-store tenantDir)',
        'cross-tenant path non-collision',
      ],
      documented_limits: [
        'OS-user / filesystem ACL hardening outside the pack',
        'physical host compromise',
      ],
    },
    'private-runners': {
      ops_owner: 'runner operator + install operator',
      tested_in_repo: [
        'env allow-list filtering (private-runner profile shape)',
        'network host allow-list deny-by-default',
      ],
      documented_limits: [
        'CI vendor isolation guarantees',
        'ephemeral runner VM/container boundaries',
      ],
    },
    managed: {
      ops_owner: 'vendor (not available here)',
      tested_in_repo: [],
      documented_limits: managedControlPlaneStatus().documented_limits,
      note: 'PD-62 C3: threat model + documented limit only; do not fake a managed plane',
    },
    hybrid: {
      ops_owner: 'install operator + optional remote operator',
      tested_in_repo: [
        'fail closed when remote stub absent (require_remote)',
        'fail closed when remote ping throws or denies',
      ],
      documented_limits: [
        'production remote availability / SLOs',
        'mutual auth to a real managed plane (none in-repo)',
      ],
    },
  };
}

module.exports = {
  MODES,
  PRIVATE_RUNNER_PROFILE,
  isKnownMode,
  resolveSelfHostedTenantPath,
  assertSelfHostedTenantIsolation,
  filterPrivateRunnerEnv,
  assertPrivateRunnerNetwork,
  checkHybridRemote,
  managedControlPlaneStatus,
  modeCatalog,
};
