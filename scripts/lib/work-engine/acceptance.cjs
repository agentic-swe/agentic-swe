'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { projectRootFromWorkDir } = require('./budget-config.cjs');

/** Characters that imply shell interpretation — fail closed (TD-15). */
const SHELL_META = /[$`|;&><\n\r]/;

/** Allowlisted string forms when not using argv JSON. */
const SAFE_STRING =
  /^(npm test|npm run [A-Za-z0-9_.:-]+|node (?:\.[/\\])?[A-Za-z0-9_./\\-]+)$/;

/**
 * @param {object} state
 * @returns {string|string[]}
 */
function acceptanceCommandFromState(state) {
  const raw = state && state.pipeline && state.pipeline.acceptance_command;
  if (Array.isArray(raw)) return raw;
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Resolve acceptance_command into argv for shell:false spawn, or an error.
 * @param {string|string[]} command
 * @returns {{ ok: true, file: string, args: string[], display: string } | { ok: true, empty: true } | { ok: false, code: string, message: string }}
 */
function resolveAcceptanceArgv(command) {
  if (command == null || command === '') {
    return { ok: true, empty: true };
  }

  if (Array.isArray(command)) {
    if (!command.length || command.some((c) => typeof c !== 'string' || !String(c).trim())) {
      return {
        ok: false,
        code: 'ACCEPTANCE_UNSAFE',
        message: 'acceptance argv must be a non-empty array of non-empty strings',
      };
    }
    const argv = command.map((c) => String(c));
    for (const part of argv) {
      if (SHELL_META.test(part)) {
        return {
          ok: false,
          code: 'ACCEPTANCE_UNSAFE',
          message: `acceptance argv element contains shell metacharacters: ${JSON.stringify(part)}`,
        };
      }
    }
    return { ok: true, file: argv[0], args: argv.slice(1), display: JSON.stringify(argv) };
  }

  const raw = String(command).trim();
  if (!raw) return { ok: true, empty: true };

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return resolveAcceptanceArgv(parsed);
    } catch {
      return {
        ok: false,
        code: 'ACCEPTANCE_UNSAFE',
        message: 'acceptance_command looks like JSON but failed to parse as an argv array',
      };
    }
  }

  if (SHELL_META.test(raw)) {
    return {
      ok: false,
      code: 'ACCEPTANCE_UNSAFE',
      message:
        'acceptance_command contains shell metacharacters; use a JSON argv array or an allowlisted string (npm test | npm run <script> | node <relpath>)',
    };
  }

  if (!SAFE_STRING.test(raw)) {
    return {
      ok: false,
      code: 'ACCEPTANCE_UNSAFE',
      message:
        'acceptance_command string is not allowlisted; use JSON argv array or npm test | npm run <script> | node <relpath>',
    };
  }

  const argv = raw.split(/\s+/);
  return { ok: true, file: argv[0], args: argv.slice(1), display: raw };
}

/**
 * Run a work item acceptance command and record verify-result.json.
 * The working directory must stay inside the project that owns the work item.
 * Always executes without a shell (TD-15).
 *
 * @param {{ workDir: string, command: string|string[], cwd?: string|null, write?: boolean }} opts
 */
function runWorkAcceptance(opts) {
  const resolved = resolveAcceptanceArgv(opts.command);
  if (!resolved.ok) return resolved;
  if (resolved.empty) {
    return { ok: true, skipped: true, reason: 'no acceptance command' };
  }

  const workDir = path.resolve(opts.workDir);
  const projectRoot = projectRootFromWorkDir(workDir) || workDir;
  let runCwd = projectRoot;
  if (opts.cwd) {
    runCwd = path.isAbsolute(opts.cwd) ? path.resolve(opts.cwd) : path.resolve(projectRoot, opts.cwd);
  }
  const rel = path.relative(projectRoot, runCwd);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      ok: false,
      code: 'ACCEPTANCE_CWD',
      message: 'acceptance cwd must stay inside the project',
    };
  }

  const result = spawnSync(resolved.file, resolved.args, {
    cwd: runCwd,
    shell: false,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, CI: '1' },
  });
  const payload = {
    command: resolved.display,
    cwd: runCwd,
    exit_code: result.status == null ? 1 : result.status,
    stdout: String(result.stdout || '').slice(-8000),
    stderr: String(result.stderr || '').slice(-8000),
    at: new Date().toISOString(),
  };

  if (opts.write !== false) {
    fs.writeFileSync(path.join(workDir, 'verify-result.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }

  if (payload.exit_code !== 0) {
    return {
      ok: false,
      code: 'ACCEPTANCE_FAILED',
      message: `acceptance command exited ${payload.exit_code}`,
      verify: payload,
    };
  }
  return { ok: true, verify: payload };
}

/**
 * A completed work item whose captured verify log failed does not pass.
 * @param {string} workDir
 * @returns {boolean} true when verify-result.json records a non-zero exit
 */
function verifyResultFailed(workDir) {
  const file = path.join(workDir, 'verify-result.json');
  if (!fs.existsSync(file)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Number(parsed.exit_code) !== 0;
  } catch {
    return true;
  }
}

module.exports = {
  acceptanceCommandFromState,
  resolveAcceptanceArgv,
  runWorkAcceptance,
  verifyResultFailed,
};
