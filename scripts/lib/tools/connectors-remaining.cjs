'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { redactSecrets } = require('../shared/redact.cjs');
const { callerGrantInjection, authorizedFromContext } = require('./grant-guard.cjs');
const redactText = (value) => redactSecrets(String(value)).redacted;

const SHELL_META = /[;&|><$`(){}\[\]!*?~\n\r]/;
const PROTECTED_REFS = new Set(['main', 'master', 'develop', 'production', 'release']);

function result(data, error) {
  return error
    ? { ok: false, status: 'error', data: null, error }
    : { ok: true, status: 'ok', data };
}

function runProcess(file, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: { ...(opts.env || process.env), CI: '1' },
      shell: false,
      signal: opts.signal,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b; });
    child.stderr.on('data', (b) => { stderr += b; });
    child.on('error', (error) => resolve({ code: null, stdout, stderr, error }));
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function gitError(run, operation) {
  return { code: 'GIT_FAILED', message: `${operation}: ${String(run.stderr || '').trim() || `exit ${run.code}`}` };
}

/**
 * Local git is deliberately argv-only. `run` is injectable so connector tests never
 * need to invoke a real git process.
 */
function createGitConnector({ root = process.cwd(), run = runProcess, protectedRefs = PROTECTED_REFS, journal = null } = {}) {
  const exec = async (args, cwd = root) => {
    const r = await run('git', args, { cwd });
    if (journal && typeof journal.record === 'function') journal.record({ connector: 'git', operation: args[0], args: args.slice(1).map(redactText), cwd });
    return r.code === 0 ? result(String(r.stdout || '').trim()) : result(null, gitError(r, args[0]));
  };
  return {
    async status() { return exec(['status', '--short']); },
    async diff(opts = {}) { return exec(['diff', ...(opts.stat ? ['--stat'] : []), ...(opts.ref ? [opts.ref] : [])]); },
    async branch() { return exec(['branch', '--show-current']); },
    async commit(message, opts = {}) {
      if (typeof message !== 'string' || !message.trim()) return result(null, { code: 'GIT_INPUT_INVALID', message: 'commit message is required' });
      return exec(['commit', '-m', message], opts.cwd || root);
    },
    async worktreeAdd(childId, opts = {}) {
      if (!/^[A-Za-z0-9._-]+$/.test(String(childId))) {
        return result(null, { code: 'GIT_INPUT_INVALID', message: 'child id contains unsafe characters' });
      }
      const parent = opts.parent || fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-worktrees-'));
      const worktree = path.join(parent, String(childId));
      const created = await exec(['worktree', 'add', '--detach', worktree, opts.ref || 'HEAD'], root);
      if (!created.ok) return created;
      return result({ path: worktree, child_id: String(childId), output: created.data });
    },
    async worktreeRemove(worktree) {
      if (typeof worktree !== 'string' || !path.isAbsolute(worktree)) {
        return result(null, { code: 'GIT_INPUT_INVALID', message: 'worktree must be an absolute path' });
      }
      const removed = await exec(['worktree', 'remove', '--force', worktree], root);
      return removed;
    },
    async push({ remote = 'origin', branch, ref } = {}, opts = {}) {
      const target = ref || branch;
      if (!target || typeof target !== 'string') return result(null, { code: 'GIT_INPUT_INVALID', message: 'branch or ref is required' });
      const shortRef = target.replace(/^refs\/heads\//, '');
      if (protectedRefs.has(shortRef) || [...protectedRefs].some((p) => shortRef.startsWith(`${p}/`))) {
        return result(null, { code: 'PROTECTED_REF', message: `push to protected ref ${shortRef} is refused` });
      }
      if (!opts.authorized || !(opts.authorized instanceof Set ? opts.authorized : new Set(opts.authorized)).has('github.branch.push')) {
        return result(null, { code: 'DENIED_UNAUTHORIZED', message: 'github.branch.push grant is required' });
      }
      return exec(['push', remote, `HEAD:refs/heads/${shortRef}`], opts.cwd || root);
    },
  };
}

function shellArgvSafe(argv) {
  return Array.isArray(argv) && argv.every((arg) => typeof arg === 'string' && !SHELL_META.test(arg));
}

function createShellConnector({ commands = {}, run = runProcess, cwd = process.cwd(), journal = null } = {}) {
  async function execute(commandId, argv = [], opts = {}) {
    const command = commands[commandId];
    if (!command || !shellArgvSafe(argv)) {
      return result(null, { code: !command ? 'SHELL_COMMAND_DENIED' : 'SHELL_METACHARACTER_DENIED', message: !command ? `command id ${commandId} is not allow-listed` : 'shell metacharacters are not allowed' });
    }
    const file = typeof command === 'string' ? command : command.file;
    const fixed = typeof command === 'string' ? [] : (command.args || []);
    const r = await run(file, [...fixed, ...argv], { cwd: opts.cwd || cwd, signal: opts.signal, env: opts.env });
    if (journal && typeof journal.record === 'function') journal.record({ connector: 'shell', command_id: commandId, argv: argv.map(redactText) });
    return r.code === 0
      ? result({ stdout: r.stdout || '', stderr: r.stderr || '', exit_code: 0 })
      : result({ stdout: r.stdout || '', stderr: r.stderr || '', exit_code: r.code }, { code: 'SHELL_FAILED', message: String(r.stderr || `exit ${r.code}`).trim() });
  }
  return { execute, isSafeArgv: shellArgvSafe, commands: Object.keys(commands) };
}

function createShellTool(options = {}) {
  const connector = createShellConnector(options);
  return {
    manifest: {
      id: 'shell.exec', version: '1.0.0', description: 'Execute an allow-listed argv command',
      permissions: ['proc.exec:allowlisted'], side_effects: 'local', idempotency: 'idempotent', timeout_ms: 30000,
      input_schema: { type: 'object', additionalProperties: false, required: ['command_id'], properties: { command_id: { type: 'string' }, argv: { type: 'array', items: { type: 'string' } } } },
    },
    execute: (input, context) => connector.execute(input.command_id, input.argv || [], context),
  };
}

function fixtureStatus(fixture, sha) {
  if (fixture && typeof fixture === 'object' && (fixture.state || fixture.conclusion || fixture.status)) {
    if (fixture.state === 'success' || fixture.conclusion === 'success' || fixture.status === 'success') return 'pass';
    if (fixture.state === 'pending' || fixture.status === 'pending') return 'pending';
    if (fixture.state === 'failure' || fixture.conclusion === 'failure' || fixture.status === 'failure') return 'fail';
  }
  const value = fixture && (fixture[sha] || fixture.default || fixture);
  if (!value) return 'missing';
  if (typeof value === 'string') return value;
  if (value.status) return value.status;
  if (value.conclusion === 'success') return 'pass';
  if (value.conclusion === 'failure') return 'fail';
  return value.state === 'pending' ? 'pending' : 'missing';
}

function createCiConnector({ checkRuns = {}, statuses = {}, journal = null } = {}) {
  return {
    async status(sha) {
      const runs = checkRuns[sha] || [];
      if (journal && typeof journal.record === 'function') journal.record({ connector: 'ci', operation: 'status', sha });
      const entries = [...runs, ...(statuses[sha] || [])].map((entry) => ({
        name: entry.name || entry.context,
        status: entry.status || 'completed',
        conclusion: entry.conclusion || (entry.state === 'success' ? 'success' : entry.state),
      }));
      if (!entries.length) return result({ sha, state: 'missing', checks: [] });
      const state = entries.some((e) => e.status !== 'completed' || e.conclusion === 'pending')
        ? 'pending'
        : entries.some((e) => !['success', 'neutral', 'skipped'].includes(e.conclusion))
          ? 'fail' : 'pass';
      return result({ sha, state, checks: entries });
    },
    fromFixture(sha, fixture) { return fixtureStatus(fixture, sha); },
  };
}

function hostAllowed(host, allowlist) {
  return (allowlist || []).some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function createDocsConnector({ root = process.cwd(), allowedHosts = [], fetcher = null, journal = null } = {}) {
  return {
    async readFile(file) {
      const full = path.resolve(root, file);
      if (journal && typeof journal.record === 'function') journal.record({ connector: 'docs', operation: 'read', file });
      if (full !== path.resolve(root, file) || !full.startsWith(`${path.resolve(root)}${path.sep}`)) {
        return result(null, { code: 'DOCS_PATH_DENIED', message: 'path is outside the repository' });
      }
      try { return result(fs.readFileSync(full, 'utf8')); } catch (error) { return result(null, { code: 'DOCS_NOT_FOUND', message: error.message }); }
    },
    async fetch(url) {
      let parsed;
      try { parsed = new URL(url); } catch { return result(null, { code: 'DOCS_URL_DENIED', message: 'invalid URL' }); }
      if (!['http:', 'https:'].includes(parsed.protocol) || !hostAllowed(parsed.hostname, allowedHosts)) {
        if (journal && typeof journal.record === 'function') journal.record({ connector: 'docs', operation: 'fetch', host: parsed.hostname, denied: true });
        return result(null, { code: 'DOCS_HOST_DENIED', message: `host ${parsed.hostname} is not allow-listed` });
      }
      if (journal && typeof journal.record === 'function') journal.record({ connector: 'docs', operation: 'fetch', host: parsed.hostname });
      if (typeof fetcher !== 'function') return result(null, { code: 'DOCS_NETWORK_DISABLED', message: 'network fetch requires an injected transport' });
      return fetcher(url);
    },
  };
}

function denyCallerGrant(key) {
  return result(null, {
    code: 'DENIED_UNAUTHORIZED',
    message: `caller-supplied ${key} is not accepted; grants come only from the policy engine`,
  });
}

const GIT_LOCAL_OPS = new Set(['status', 'diff', 'branch', 'commit', 'worktreeAdd', 'worktreeRemove']);

function createGitLocalTool(git) {
  return {
    manifest: {
      id: 'git.local',
      version: '1.0.0',
      description: 'Local git read/write helpers (push is git.push)',
      permissions: [],
      side_effects: 'local',
      idempotency: 'idempotent',
      timeout_ms: 30000,
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['operation'],
        properties: {
          operation: { type: 'string', enum: [...GIT_LOCAL_OPS] },
          message: { type: 'string' },
          cwd: { type: 'string' },
          stat: { type: 'boolean' },
          ref: { type: 'string' },
          child_id: { type: 'string' },
          childId: { type: 'string' },
          parent: { type: 'string' },
          worktree: { type: 'string' },
          // Legacy positional bag (never includes grants; grant keys are rejected in execute).
          args: { type: 'array', items: { type: 'object' } },
        },
      },
    },
    execute: async (input) => {
      const injected = callerGrantInjection(input);
      if (injected) return denyCallerGrant(injected);
      const op = String(input.operation || '');
      if (op === 'push') {
        return result(null, {
          code: 'DENIED_UNAUTHORIZED',
          message: 'git.local cannot push; use git.push with a policy grant',
        });
      }
      if (!GIT_LOCAL_OPS.has(op)) {
        return result(null, { code: 'GIT_INPUT_INVALID', message: `unknown or disallowed operation ${op}` });
      }
      // Legacy shape: { operation, args: [payload] }. Never spread args into method opts.
      const payload = input.args && input.args[0] && typeof input.args[0] === 'object'
        ? input.args[0]
        : input;
      const injectedPayload = callerGrantInjection(payload);
      if (injectedPayload) return denyCallerGrant(injectedPayload);
      switch (op) {
        case 'status': return git.status();
        case 'diff': return git.diff({ stat: payload.stat, ref: payload.ref });
        case 'branch': return git.branch();
        case 'commit': return git.commit(payload.message, { cwd: payload.cwd });
        case 'worktreeAdd': return git.worktreeAdd(payload.child_id || payload.childId, { parent: payload.parent, ref: payload.ref });
        case 'worktreeRemove': return git.worktreeRemove(payload.worktree);
        default: return result(null, { code: 'GIT_INPUT_INVALID', message: `unknown operation ${op}` });
      }
    },
  };
}

function createGitPushTool(git) {
  return {
    manifest: {
      id: 'git.push',
      version: '1.0.0',
      description: 'Push HEAD to a non-protected remote ref (requires github.branch.push grant)',
      permissions: ['github.branch.push'],
      side_effects: 'remote',
      idempotency: 'non-idempotent',
      timeout_ms: 60000,
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          remote: { type: 'string' },
          branch: { type: 'string' },
          ref: { type: 'string' },
          cwd: { type: 'string' },
        },
      },
    },
    execute: async (input = {}, context = {}) => {
      const injected = callerGrantInjection(input);
      if (injected) return denyCallerGrant(injected);
      return git.push(
        { remote: input.remote, branch: input.branch, ref: input.ref },
        { authorized: authorizedFromContext(context), cwd: input.cwd }
      );
    },
  };
}

function createRemainingTools(options = {}) {
  const git = createGitConnector(options.git || options);
  const shell = createShellTool(options.shell || {});
  const ci = options.ci || {};
  const docs = createDocsConnector(options.docs || {});
  return [
    createGitLocalTool(git),
    createGitPushTool(git),
    shell,
    { manifest: { id: 'ci.status', version: '1.0.0', permissions: ['checks:read'], input_schema: { type: 'object', required: ['sha'], properties: { sha: { type: 'string' } } }, side_effects: 'none', idempotency: 'idempotent', timeout_ms: 30000 }, execute: (input) => (ci.status ? ci.status(input.sha) : createCiConnector(ci).status(input.sha)) },
    { manifest: { id: 'docs.read', version: '1.0.0', permissions: [], input_schema: { type: 'object', required: ['file'], properties: { file: { type: 'string' } } }, side_effects: 'none', idempotency: 'idempotent', timeout_ms: 30000 }, execute: (input) => docs.readFile(input.file) },
  ];
}

module.exports = {
  SHELL_META, PROTECTED_REFS, shellArgvSafe, createGitConnector, createShellConnector,
  createShellTool, createCiConnector, createDocsConnector, createRemainingTools,
  createGitLocalTool, createGitPushTool,
  createGitTools: createRemainingTools,
  createShellTools: createShellTool,
  createCITools: createCiConnector,
  createDocsTools: createDocsConnector,
};
