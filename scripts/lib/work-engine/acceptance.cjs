'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { projectRootFromWorkDir } = require('./budget-config.cjs');

/**
 * @param {object} state
 * @returns {string}
 */
function acceptanceCommandFromState(state) {
  const raw = state && state.pipeline && state.pipeline.acceptance_command;
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Run a work item acceptance command and record verify-result.json.
 * The working directory must stay inside the project that owns the work item.
 *
 * @param {{ workDir: string, command: string, cwd?: string|null, write?: boolean }} opts
 */
function runWorkAcceptance(opts) {
  const command = String(opts.command || '').trim();
  if (!command) {
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

  const result = spawnSync(command, {
    cwd: runCwd,
    shell: true,
    encoding: 'utf8',
    timeout: 120000,
    env: { ...process.env, CI: '1' },
  });
  const payload = {
    command,
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
  runWorkAcceptance,
  verifyResultFailed,
};
