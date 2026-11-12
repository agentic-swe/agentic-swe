'use strict';

/**
 * AE-027a / ADR-009 / PD-31: process-level sandbox profiles.
 *
 * These are declarative envelopes enforced before spawn (argv-only, minimal
 * child env, PDP on every run, network deny-by-default). They are NOT
 * OS-user or container/VM isolation.
 *
 * Profiles are opt-in / additive. Resolving or applying a profile does not
 * mutate config/default-policy.json, restricted-ops, or PDP baseline rules.
 */

const path = require('node:path');
const { spawn } = require('node:child_process');
const { minimalChildEnv, resolveCommandArgv, SHELL_META } = require('../shared/child-env.cjs');

/** Secret-shaped keys that must never enter a sandboxed child via extras. */
const SECRET_ENV_RE = /^(?:.*_)?(?:TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIALS?)$/i;
const KNOWN_SECRET_KEYS = new Set([
  'GITHUB_TOKEN',
  'NPM_TOKEN',
  'GH_TOKEN',
  'NODE_AUTH_TOKEN',
  'AWS_SECRET_ACCESS_KEY',
  'AGENTIC_SWE_GITHUB_TOKEN',
]);

/**
 * Named process profiles (PD-31). Additive code surface — selecting one does
 * not change existing tool manifests unless a caller opts in.
 * @type {Record<string, object>}
 */
const SANDBOX_PROFILES = Object.freeze({
  'plugin-untrusted': Object.freeze({
    id: 'plugin-untrusted',
    shell: false,
    network: 'deny',
    net_hosts: Object.freeze([]),
    /** null = no extra keys beyond minimalChildEnv base (+ declared secrets.read grants elsewhere). */
    env_allowlist: null,
    fs_write: Object.freeze([]),
    cwd_root: null,
    timeout_ms: 30000,
    output_cap: 1024 * 1024,
    require_pdp_allow: true,
  }),
  'process-default': Object.freeze({
    id: 'process-default',
    shell: false,
    network: 'deny',
    net_hosts: Object.freeze([]),
    env_allowlist: null,
    fs_write: Object.freeze([]),
    cwd_root: null,
    timeout_ms: 60000,
    output_cap: 1024 * 1024,
    require_pdp_allow: true,
  }),
});

function cloneProfile(base) {
  return {
    ...base,
    net_hosts: [...(base.net_hosts || [])],
    fs_write: [...(base.fs_write || [])],
    env_allowlist: base.env_allowlist == null ? null : [...base.env_allowlist],
  };
}

/**
 * Resolve a named profile or merge manifest.sandbox overrides onto a base.
 * @param {string|object|null|undefined} nameOrManifestSandbox
 * @param {{ profile?: string, cwd_root?: string }} [opts]
 */
function resolveSandboxProfile(nameOrManifestSandbox, opts = {}) {
  let profileId = opts.profile || 'plugin-untrusted';
  let overlay = null;
  if (typeof nameOrManifestSandbox === 'string') {
    profileId = nameOrManifestSandbox;
  } else if (nameOrManifestSandbox && typeof nameOrManifestSandbox === 'object') {
    overlay = nameOrManifestSandbox;
    if (typeof overlay.profile === 'string' && overlay.profile.trim()) {
      profileId = overlay.profile.trim();
    }
  }
  const base = SANDBOX_PROFILES[profileId];
  if (!base) {
    return {
      ok: false,
      code: 'SANDBOX_PROFILE_UNKNOWN',
      message: `unknown sandbox profile ${JSON.stringify(profileId)}`,
    };
  }
  const profile = cloneProfile(base);
  if (overlay) {
    if (overlay.cwd_root != null) profile.cwd_root = String(overlay.cwd_root);
    if (Array.isArray(overlay.fs_write)) profile.fs_write = overlay.fs_write.map(String);
    if (Array.isArray(overlay.env)) profile.env_allowlist = overlay.env.map(String);
    if (Array.isArray(overlay.net_hosts)) {
      profile.net_hosts = overlay.net_hosts.map(String);
      profile.network = overlay.net_hosts.length ? 'allowlist' : 'deny';
    }
    if (typeof overlay.output_cap === 'number' && overlay.output_cap > 0) {
      profile.output_cap = overlay.output_cap;
    }
  }
  if (opts.cwd_root != null) profile.cwd_root = String(opts.cwd_root);
  if (typeof opts.timeout_ms === 'number' && opts.timeout_ms > 0) {
    profile.timeout_ms = opts.timeout_ms;
  }
  return { ok: true, profile };
}

function isSecretEnvKey(key) {
  const name = String(key || '');
  return KNOWN_SECRET_KEYS.has(name) || SECRET_ENV_RE.test(name);
}

/**
 * Build a sandboxed child env from minimalChildEnv. Parent secrets are never
 * inherited. Extra keys must pass the profile allow-list (when set) and must
 * not look like secrets unless explicitly allow-listed by name.
 * @param {object} profile
 * @param {Record<string, string>} [extra]
 */
function buildSandboxEnv(profile, extra = {}) {
  // Fail closed: extras are admitted only when the profile declares an allow-list.
  // A null/absent allow-list means minimalChildEnv base keys only (PD-31).
  const filtered = {};
  const allow = Array.isArray(profile.env_allowlist) ? profile.env_allowlist : null;
  if (allow) {
    for (const [key, value] of Object.entries(extra || {})) {
      if (value == null) continue;
      const name = String(key);
      if (!name.trim()) continue;
      if (!allow.includes(name)) continue;
      if (isSecretEnvKey(name)) continue;
      filtered[name] = String(value);
    }
  }
  const env = minimalChildEnv(filtered);
  // Defense in depth: strip any secret-shaped keys that somehow appeared.
  for (const key of Object.keys(env)) {
    if (isSecretEnvKey(key)) delete env[key];
  }
  return env;
}

/**
 * Reject shell set to true and shell-metacharacter argv (PD-31 / ADR-009).
 * @param {{ shell?: boolean, argv?: string[]|string, command?: string|string[] }} opts
 */
function assertSandboxArgv(opts = {}) {
  if (opts.shell === true) {
    return {
      ok: false,
      code: 'SANDBOX_SHELL_DENIED',
      message: 'shell set to true is not permitted under process sandbox profiles',
    };
  }
  const command = opts.argv != null ? opts.argv : opts.command;
  if (command == null) return { ok: true, empty: true };
  const resolved = resolveCommandArgv(command);
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.code === 'SHELL_META' ? 'SANDBOX_SHELL_META' : resolved.code,
      message: resolved.message,
    };
  }
  if (resolved.empty) return { ok: true, empty: true };
  return { ok: true, file: resolved.file, args: resolved.args, display: resolved.display };
}

function hostAllowed(host, allowlist) {
  return (allowlist || []).some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Network is deny-by-default. A fetch requires an allow-listed host AND an
 * injected transport function (same pattern as docs connector).
 * @param {object} profile
 * @param {string} url
 * @param {{ transport?: Function|null }} [opts]
 */
function assertSandboxNetwork(profile, url, opts = {}) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return { ok: false, code: 'SANDBOX_URL_DENIED', message: 'invalid URL' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, code: 'SANDBOX_URL_DENIED', message: `protocol ${parsed.protocol} is not permitted` };
  }
  const network = profile.network || 'deny';
  const hosts = profile.net_hosts || [];
  if (network === 'deny' || !hosts.length) {
    return {
      ok: false,
      code: 'SANDBOX_NETWORK_DENIED',
      message: 'network is deny-by-default under process sandbox profiles',
    };
  }
  if (!hostAllowed(parsed.hostname, hosts)) {
    return {
      ok: false,
      code: 'SANDBOX_HOST_DENIED',
      message: `host ${parsed.hostname} is not allow-listed`,
    };
  }
  if (typeof opts.transport !== 'function') {
    return {
      ok: false,
      code: 'SANDBOX_NETWORK_DISABLED',
      message: 'network fetch requires an injected allow-listed transport',
    };
  }
  return { ok: true, url: parsed, transport: opts.transport };
}

/**
 * FS write allow-list relative to profile.cwd_root (realpath when possible).
 * Empty fs_write → no writes permitted through this gate.
 * @param {object} profile
 * @param {string} targetPath
 */
function assertSandboxFsWrite(profile, targetPath) {
  const root = profile.cwd_root;
  if (!root || typeof root !== 'string' || !root.trim()) {
    return {
      ok: false,
      code: 'SANDBOX_FS_ROOT_REQUIRED',
      message: 'cwd_root is required for fs.write checks',
    };
  }
  const rootAbs = path.resolve(root);
  let targetAbs;
  try {
    targetAbs = path.resolve(rootAbs, targetPath);
  } catch {
    return { ok: false, code: 'SANDBOX_FS_DENIED', message: 'invalid write path' };
  }
  if (targetAbs !== rootAbs && !targetAbs.startsWith(`${rootAbs}${path.sep}`)) {
    return {
      ok: false,
      code: 'SANDBOX_FS_DENIED',
      message: 'write path escapes cwd_root',
    };
  }
  const rel = path.relative(rootAbs, targetAbs).split(path.sep).join('/');
  const globs = profile.fs_write || [];
  if (!globs.length) {
    return {
      ok: false,
      code: 'SANDBOX_FS_DENIED',
      message: 'fs.write allow-list is empty',
    };
  }
  const matched = globs.some((glob) => matchSimpleGlob(rel, String(glob).replace(/^\.\//, '')));
  if (!matched) {
    return {
      ok: false,
      code: 'SANDBOX_FS_DENIED',
      message: `path ${rel} is outside fs.write allow-list`,
    };
  }
  // Always-denied integrity paths (ADR-009), even if a glob would match.
  if (/(^|\/)(\.worklogs\/|\.git\/hooks\/|\.git\/config$|config\/default-policy\.json$)/.test(rel)) {
    return {
      ok: false,
      code: 'SANDBOX_FS_DENIED',
      message: `path ${rel} is always denied`,
    };
  }
  return { ok: true, path: targetAbs, relative: rel };
}

/** Minimal glob: `*` (no `/`), `**` across segments, exact otherwise. */
function matchSimpleGlob(relPath, pattern) {
  const norm = String(relPath || '');
  const pat = String(pattern || '');
  if (pat === '**' || pat === '**/*') return true;
  if (!pat.includes('*')) return norm === pat;
  const escaped = pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${escaped}$`).test(norm);
}

/**
 * Gate a spawn under a process sandbox profile.
 * Fail-closed on missing/corrupt decision when require_pdp_allow is set.
 * @param {object} profile
 * @param {{
 *   file?: string,
 *   args?: string[],
 *   argv?: string[]|string,
 *   command?: string|string[],
 *   cwd?: string,
 *   env?: Record<string, string>,
 *   shell?: boolean,
 *   decision?: object|null,
 * }} opts
 */
function prepareSandboxSpawn(profile, opts = {}) {
  if (!profile || typeof profile !== 'object' || !profile.id) {
    return { ok: false, code: 'SANDBOX_PROFILE_REQUIRED', message: 'sandbox profile is required' };
  }
  if (profile.require_pdp_allow !== false) {
    const decision = opts.decision;
    if (!decision || typeof decision !== 'object') {
      return {
        ok: false,
        code: 'SANDBOX_POLICY_REQUIRED',
        message: 'process sandbox requires a PDP decision before spawn',
        spawned: false,
      };
    }
    if (decision.decision !== 'allow') {
      return {
        ok: false,
        code: decision.code || 'SANDBOX_POLICY_DENIED',
        message: decision.reason || 'policy denied spawn',
        spawned: false,
        decision,
      };
    }
  }
  if (opts.shell === true || profile.shell === true) {
    return {
      ok: false,
      code: 'SANDBOX_SHELL_DENIED',
      message: 'shell set to true is not permitted under process sandbox profiles',
      spawned: false,
    };
  }
  let file = opts.file;
  let args = Array.isArray(opts.args) ? opts.args.map(String) : [];
  if (file == null) {
    const argvCheck = assertSandboxArgv({
      shell: false,
      argv: opts.argv,
      command: opts.command,
    });
    if (!argvCheck.ok) return { ...argvCheck, spawned: false };
    if (argvCheck.empty) {
      return { ok: false, code: 'ARGV_INVALID', message: 'empty argv', spawned: false };
    }
    file = argvCheck.file;
    args = argvCheck.args;
  } else {
    for (const part of [file, ...args]) {
      if (typeof part !== 'string' || !part.trim()) {
        return { ok: false, code: 'ARGV_INVALID', message: 'argv must be non-empty strings', spawned: false };
      }
      if (SHELL_META.test(part)) {
        return {
          ok: false,
          code: 'SANDBOX_SHELL_META',
          message: `argv element contains shell metacharacters: ${JSON.stringify(part)}`,
          spawned: false,
        };
      }
    }
  }
  let cwd = opts.cwd != null ? String(opts.cwd) : profile.cwd_root || process.cwd();
  if (profile.cwd_root) {
    const rootAbs = path.resolve(profile.cwd_root);
    const cwdAbs = path.resolve(cwd);
    if (cwdAbs !== rootAbs && !cwdAbs.startsWith(`${rootAbs}${path.sep}`)) {
      return {
        ok: false,
        code: 'SANDBOX_CWD_DENIED',
        message: 'cwd escapes profile cwd_root',
        spawned: false,
      };
    }
    cwd = cwdAbs;
  }
  const env = buildSandboxEnv(profile, opts.env || {});
  return {
    ok: true,
    file,
    args,
    cwd,
    env,
    shell: false,
    timeout_ms: profile.timeout_ms,
    output_cap: profile.output_cap,
    profile_id: profile.id,
    spawned: false,
  };
}

/**
 * Spawn under a prepared sandbox. Returns a promise; never enables shell.
 * On policy deny / argv reject, resolves with ok:false and spawned:false
 * without invoking spawn.
 * @param {object} profile
 * @param {string|null} file
 * @param {string[]} [args]
 * @param {object} [opts]
 */
function spawnSandboxed(profile, file, args = [], opts = {}) {
  const prepared = prepareSandboxSpawn(profile, {
    file: file == null ? undefined : file,
    args,
    argv: opts.argv,
    command: opts.command,
    cwd: opts.cwd,
    env: opts.env,
    shell: opts.shell,
    decision: opts.decision,
  });
  if (!prepared.ok) {
    return Promise.resolve({
      ok: false,
      status: 'denied',
      code: prepared.code,
      message: prepared.message,
      spawned: false,
      stdout: '',
      stderr: '',
      decision: prepared.decision,
    });
  }
  const spawnImpl = typeof opts.spawn === 'function' ? opts.spawn : spawn;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child;
    try {
      child = spawnImpl(prepared.file, prepared.args, {
        cwd: prepared.cwd,
        env: prepared.env,
        shell: false,
        signal: opts.signal,
      });
    } catch (error) {
      finish({
        ok: false,
        status: 'error',
        code: error && error.code ? error.code : 'SPAWN_ERROR',
        message: error && error.message ? error.message : 'spawn failed',
        spawned: false,
        stdout: '',
        stderr: '',
      });
      return;
    }
    let stdout = '';
    let stderr = '';
    const cap = prepared.output_cap || 1024 * 1024;
    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', (chunk) => {
        if (stdout.length < cap) stdout += chunk;
      });
    }
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => {
        if (stderr.length < cap) stderr += chunk;
      });
    }
    child.on('error', (error) => {
      finish({
        ok: false,
        status: 'error',
        code: error && error.code ? error.code : 'SPAWN_ERROR',
        message: error && error.message ? error.message : 'spawn error',
        spawned: true,
        stdout,
        stderr,
      });
    });
    child.on('close', (code, signal) => {
      finish({
        ok: code === 0,
        status: code === 0 ? 'ok' : 'error',
        code: code === 0 ? undefined : 'SANDBOX_EXIT',
        message: code === 0 ? undefined : `exit ${code}${signal ? ` (${signal})` : ''}`,
        exit_code: code,
        signal,
        spawned: true,
        stdout,
        stderr,
        env: prepared.env,
        profile_id: prepared.profile_id,
      });
    });
  });
}

/**
 * Fetch via sandbox network gate (deny-by-default + injected transport).
 */
async function fetchUnderSandbox(profile, url, opts = {}) {
  const gate = assertSandboxNetwork(profile, url, opts);
  if (!gate.ok) {
    return { ok: false, status: 'denied', error: { code: gate.code, message: gate.message } };
  }
  try {
    const data = await gate.transport(gate.url.href || url);
    return { ok: true, status: 'ok', data };
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      error: { code: 'SANDBOX_FETCH_FAILED', message: error && error.message ? error.message : 'fetch failed' },
    };
  }
}

module.exports = {
  SANDBOX_PROFILES,
  SECRET_ENV_RE,
  KNOWN_SECRET_KEYS,
  resolveSandboxProfile,
  buildSandboxEnv,
  assertSandboxArgv,
  assertSandboxNetwork,
  assertSandboxFsWrite,
  prepareSandboxSpawn,
  spawnSandboxed,
  fetchUnderSandbox,
  isSecretEnvKey,
  matchSimpleGlob,
};
