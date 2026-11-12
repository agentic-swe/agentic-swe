'use strict';

const { resolveAcceptanceArgv } = require('../work-engine/acceptance.cjs');
const {
  resolveSandboxProfile,
  prepareSandboxSpawn,
  spawnSandboxed,
} = require('./sandbox-profile.cjs');

const repoSchema = {
  type: 'object', additionalProperties: false, required: ['repo'],
  properties: { repo: { type: 'string', pattern: '^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$' }, number: { type: ['integer', 'string'] }, sha: { type: 'string' } },
};

const GITHUB_MANIFESTS = [
  ['github.get_pull', ['pull_requests:read'], { ...repoSchema, required: ['repo', 'number'] }, 'getPull', 'none'],
  ['github.list_reviews', ['pull_requests:read'], { ...repoSchema, required: ['repo', 'number'] }, 'listReviews', 'none'],
  ['github.list_check_runs', ['checks:read'], { ...repoSchema, required: ['repo', 'sha'] }, 'listCheckRuns', 'none'],
  ['github.pr.write', ['github.pr.write'], {
    type: 'object', additionalProperties: false, required: ['repo', 'title', 'head', 'base'],
    properties: { repo: { type: 'string' }, title: { type: 'string' }, head: { type: 'string' }, base: { type: 'string' }, body: { type: 'string' }, draft: { type: 'boolean' } },
  }, 'createPull', 'remote'],
];

function baseManifest(id, permissions, input_schema, side_effects) {
  return {
    id, version: '1.0.0', description: `AutoEng ${id}`,
    permissions, input_schema, side_effects,
    idempotency: side_effects === 'remote' ? 'non-idempotent' : 'idempotent',
    timeout_ms: 30000,
  };
}

function createGitHubTools(connector) {
  if (!connector) throw new Error('createGitHubTools requires a connector');
  return GITHUB_MANIFESTS.map(([id, permissions, input_schema, method, effects]) => ({
    manifest: baseManifest(id, permissions, input_schema, effects),
    execute: async (input) => {
      const result = await connector[method](input.repo, method === 'createPull' ? input : (method === 'listCheckRuns' ? input.sha : input.number));
      return { status: result.ok ? 'ok' : 'error', data: result.data, error: result.ok ? undefined : { code: result.code, message: result.message } };
    },
  }));
}

const TEST_MANIFEST = baseManifest('test.run', ['proc.exec:arbitrary-code'], {
  type: 'object', additionalProperties: false, required: ['command'],
  properties: {
    command: { oneOf: [{ type: 'string' }, { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } }] },
    cwd: { type: 'string' },
  },
}, 'local');
// Opt into the process sandbox profile (PD-31). Additive: profile fields merge
// onto plugin-untrusted defaults; baseline PDP / default-policy.json unchanged.
TEST_MANIFEST.sandbox = { profile: 'plugin-untrusted', output_cap: 1024 * 1024 };

async function runArgv(argv, opts) {
  const resolved = resolveSandboxProfile(opts.sandbox || { profile: 'plugin-untrusted' }, {
    cwd_root: opts.cwd_root || opts.cwd,
    timeout_ms: opts.timeout_ms,
  });
  if (!resolved.ok) {
    return { status: 'error', error: { code: resolved.code, message: resolved.message } };
  }
  const profile = resolved.profile;
  const prepared = prepareSandboxSpawn(profile, {
    file: argv[0],
    args: argv.slice(1),
    cwd: opts.cwd,
    shell: opts.shell,
    decision: opts.decision,
    env: opts.env,
  });
  if (!prepared.ok) {
    return {
      status: 'denied',
      error: { code: prepared.code, message: prepared.message },
      spawned: false,
    };
  }
  const result = await spawnSandboxed(profile, prepared.file, prepared.args, {
    cwd: prepared.cwd,
    env: opts.env,
    decision: opts.decision,
    signal: opts.signal,
    spawn: opts.spawn,
  });
  if (!result.spawned && result.status === 'denied') {
    return { status: 'denied', error: { code: result.code, message: result.message }, spawned: false };
  }
  return {
    status: result.ok ? 'ok' : 'error',
    stdout: result.stdout,
    stderr: result.stderr,
    spawned: result.spawned,
    error: result.ok
      ? undefined
      : { code: result.code || 'TEST_FAILED', message: result.message || `exit ${result.exit_code}` },
  };
}

function createTestRunnerTool({ projectRoot = process.cwd() } = {}) {
  return {
    manifest: TEST_MANIFEST,
    execute: async (input, context = {}) => {
      const command = Array.isArray(input.command) ? input.command : String(input.command).trim().split(/\s+/);
      if (
        /(?:^|[/\\])node(?:\.exe)?$/.test(command[0]) &&
        command.slice(1).some((arg) => ['-e', '--eval', '-p', '--print', '-c'].includes(arg))
      ) {
        return { status: 'error', error: { code: 'ACCEPTANCE_UNSAFE', message: 'node eval forms are not permitted' } };
      }
      if (['npx', 'npx.cmd'].includes(command[0])) {
        return { status: 'error', error: { code: 'ACCEPTANCE_UNSAFE', message: 'npx is not permitted' } };
      }
      const resolved = resolveAcceptanceArgv(input.command);
      if (!resolved.ok) return { status: 'error', error: { code: resolved.code, message: resolved.message } };
      const cwd = input.cwd ? require('node:path').resolve(projectRoot, input.cwd) : projectRoot;
      const sandbox = (context.manifest && context.manifest.sandbox) || TEST_MANIFEST.sandbox;
      // Runner attaches the PDP decision; spawn fails closed without an allow.
      const decision = context.decision || (context.opts && context.opts.decision) || null;
      return runArgv([resolved.file, ...resolved.args], {
        cwd,
        cwd_root: projectRoot,
        signal: context.signal,
        sandbox,
        decision,
        timeout_ms: context.manifest && context.manifest.timeout_ms,
      });
    },
  };
}

module.exports = { GITHUB_MANIFESTS, createGitHubTools, createTestRunnerTool, TEST_MANIFEST };
