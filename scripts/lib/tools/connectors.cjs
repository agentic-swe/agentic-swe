'use strict';

const { spawn } = require('node:child_process');
const { resolveAcceptanceArgv } = require('../work-engine/acceptance.cjs');

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
TEST_MANIFEST.sandbox = { output_cap: 1024 * 1024 };

function runArgv(argv, opts) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: opts.cwd,
      shell: false,
      signal: opts.signal,
      env: { CI: '1', PATH: process.env.PATH || '' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ status: 'error', stdout, stderr, error: { code: error.code || 'SPAWN_ERROR', message: error.message } }));
    child.on('close', (code, signal) => resolve({
      status: code === 0 ? 'ok' : 'error', stdout, stderr,
      error: code === 0 ? undefined : { code: 'TEST_FAILED', message: `exit ${code}${signal ? ` (${signal})` : ''}` },
    }));
  });
}

function createTestRunnerTool({ projectRoot = process.cwd() } = {}) {
  return {
    manifest: TEST_MANIFEST,
    execute: async (input, context) => {
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
      return runArgv([resolved.file, ...resolved.args], { cwd, signal: context.signal });
    },
  };
}

module.exports = { GITHUB_MANIFESTS, createGitHubTools, createTestRunnerTool, TEST_MANIFEST };
