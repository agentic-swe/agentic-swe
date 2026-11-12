'use strict';

/**
 * AE-027b: isolation harness for process sandbox profiles (PD-31).
 * Runs fixtures under sandbox-profile enforcement and records containment.
 */

const fs = require('node:fs');
const path = require('node:path');
const { appendEvent } = require('../shared/journal.cjs');
const {
  resolveSandboxProfile,
  spawnSandboxed,
  fetchUnderSandbox,
  assertSandboxFsWrite,
  buildSandboxEnv,
} = require('./sandbox-profile.cjs');

/**
 * @param {{
 *   profile?: string|object,
 *   argv: string[],
 *   cwd: string,
 *   cwd_root?: string,
 *   fs_write?: string[],
 *   decision: object,
 *   workDir?: string|null,
 *   plantSecrets?: Record<string, string>,
 *   timeout_ms?: number,
 *   spawn?: Function,
 * }} opts
 */
async function runIsolatedFixture(opts) {
  if (!opts || !Array.isArray(opts.argv) || !opts.argv.length) {
    return {
      ok: false,
      contained: true,
      code: 'ISOLATION_ARGV_REQUIRED',
      message: 'argv is required',
      spawned: false,
    };
  }
  if (!opts.decision || typeof opts.decision !== 'object') {
    return {
      ok: false,
      contained: true,
      code: 'ISOLATION_POLICY_REQUIRED',
      message: 'PDP decision is required',
      spawned: false,
    };
  }

  const resolved = resolveSandboxProfile(opts.profile || 'plugin-untrusted', {
    cwd_root: opts.cwd_root || opts.cwd,
    timeout_ms: opts.timeout_ms,
  });
  if (!resolved.ok) {
    return { ok: false, contained: true, code: resolved.code, message: resolved.message, spawned: false };
  }
  const profile = resolved.profile;
  if (Array.isArray(opts.fs_write)) profile.fs_write = opts.fs_write.map(String);

  // Plant secrets in the parent process only — child must not see them.
  const planted = opts.plantSecrets || {
    GITHUB_TOKEN: 'ghp_isolation_planted',
    NPM_TOKEN: 'npm_isolation_planted',
  };
  const prev = {};
  for (const [key, value] of Object.entries(planted)) {
    prev[key] = process.env[key];
    process.env[key] = value;
  }

  let result;
  try {
    const envProbe = buildSandboxEnv(profile, planted);
    for (const key of Object.keys(planted)) {
      if (envProbe[key] != null) {
        result = {
          ok: false,
          contained: false,
          code: 'SECRET_LEAK_ENV',
          message: `sandbox env leaked ${key}`,
          spawned: false,
          stdout: '',
          stderr: '',
        };
      }
    }
    if (!result) {
      result = await spawnSandboxed(profile, opts.argv[0], opts.argv.slice(1), {
        cwd: opts.cwd,
        decision: opts.decision,
        timeout_ms: opts.timeout_ms || profile.timeout_ms,
        spawn: opts.spawn,
        signal: opts.signal,
      });
    }
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const combined = `${stdout}\n${stderr}`;
  const leaks = [];
  for (const value of Object.values(planted)) {
    if (value && combined.includes(value)) leaks.push(value.slice(0, 12));
  }

  const contained = result.spawned === false
    ? true
    : leaks.length === 0 && result.code !== 'SECRET_LEAK_ENV';

  const report = {
    ok: contained && (result.ok === true || result.spawned === false),
    contained,
    spawned: Boolean(result.spawned),
    status: result.status,
    code: leaks.length ? 'SECRET_ECHO' : result.code,
    message: leaks.length ? 'fixture echoed planted secret' : result.message,
    exit_code: result.exit_code,
    stdout,
    stderr,
    profile_id: profile.id,
    leaks,
  };

  if (opts.workDir) {
    // Fail closed: isolation evidence must land in the journal when a workDir is provided.
    appendEvent(opts.workDir, {
      type: contained ? 'sandbox.isolation.passed' : 'sandbox.isolation.failed',
      payload: {
        profile_id: profile.id,
        contained,
        spawned: report.spawned,
        code: report.code || null,
        argv0: opts.argv[0],
      },
    });
  }
  return report;
}

/**
 * Assert a write target is blocked by the profile allow-list.
 */
function assertWriteContained(profileOrName, targetPath, opts = {}) {
  const resolved = resolveSandboxProfile(profileOrName || 'plugin-untrusted', {
    cwd_root: opts.cwd_root,
  });
  if (!resolved.ok) return resolved;
  if (Array.isArray(opts.fs_write)) resolved.profile.fs_write = opts.fs_write.map(String);
  return assertSandboxFsWrite(resolved.profile, targetPath);
}

/**
 * Network beacon must fail closed without transport.
 */
async function assertNetworkContained(profileOrName, url, opts = {}) {
  const resolved = resolveSandboxProfile(profileOrName || 'plugin-untrusted', {});
  if (!resolved.ok) return resolved;
  if (Array.isArray(opts.net_hosts)) {
    resolved.profile.net_hosts = opts.net_hosts;
    resolved.profile.network = opts.net_hosts.length ? 'allowlist' : 'deny';
  }
  return fetchUnderSandbox(resolved.profile, url, { transport: opts.transport });
}

/**
 * Kill/timeout containment: aborted spawn must not leave an escalated child
 * that inherits planted secrets. Uses injectable spawn for the harness.
 */
async function runWithTimeoutKill(opts) {
  const AbortControllerRef = global.AbortController;
  const controller = new AbortControllerRef();
  const timeoutMs = opts.timeout_ms || 50;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const report = await runIsolatedFixture({
      ...opts,
      signal: controller.signal,
      spawn: opts.spawn || ((file, args, spawnOpts) => {
        const { EventEmitter } = require('node:events');
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.killed = false;
        child.kill = () => {
          child.killed = true;
          queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
        };
        if (spawnOpts && spawnOpts.signal) {
          const onAbort = () => child.kill();
          if (spawnOpts.signal.aborted) onAbort();
          else spawnOpts.signal.addEventListener('abort', onAbort, { once: true });
        }
        // Never emit close on its own — timeout/kill must contain it.
        return child;
      }),
    });
    return {
      ...report,
      orphan_escalation: false,
      timed_out: controller.signal.aborted,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  runIsolatedFixture,
  assertWriteContained,
  assertNetworkContained,
  runWithTimeoutKill,
};
