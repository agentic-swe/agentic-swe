'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { hostOutput, normalizePayload } = require('../scripts/host-lifecycle.cjs');

const root = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

test('normalizes Codex, Antigravity, and Windsurf lifecycle payloads', () => {
  const codex = normalizePayload(
    { cwd: '/tmp/codex', transcript_path: '/tmp/codex/session.jsonl' },
  );
  assert.equal(codex.projectRoot, '/tmp/codex');
  assert.equal(codex.transcriptPath, '/tmp/codex/session.jsonl');

  const antigravity = normalizePayload(
    { workspacePaths: ['/tmp/antigravity'], transcriptPath: '/tmp/antigravity/session.json' },
  );
  assert.equal(antigravity.projectRoot, '/tmp/antigravity');
  assert.equal(antigravity.transcriptPath, '/tmp/antigravity/session.json');

  const windsurf = normalizePayload({
    tool_info: {
      root_workspace_path: '/tmp/windsurf',
      transcript_path: '/tmp/windsurf/transcript.json',
    },
  });
  assert.equal(windsurf.projectRoot, '/tmp/windsurf');
  assert.equal(windsurf.transcriptPath, '/tmp/windsurf/transcript.json');
});

test('emits the required Antigravity response contracts', () => {
  assert.deepEqual(hostOutput('antigravity', 'start'), { injectSteps: [] });
  assert.deepEqual(hostOutput('antigravity', 'prompt'), { injectSteps: [] });
  assert.deepEqual(hostOutput('antigravity', 'stop'), { decision: 'stop' });
});

test('all native lifecycle manifests parse and target the shared adapter', () => {
  const manifests = [
    '.codex-plugin/hooks/hooks.json',
    'integrations/codex/hooks.json',
    'integrations/antigravity/hooks.json',
    'integrations/windsurf/hooks.json',
    'integrations/kiro/agentic-swe-memory.json',
    'integrations/copilot/agentic-swe.json',
  ];
  for (const manifest of manifests) {
    const body = fs.readFileSync(path.join(root, manifest), 'utf8');
    assert.doesNotThrow(() => JSON.parse(body), manifest);
    assert.match(body, /session-start|host-lifecycle\.cjs/, manifest);
  }
});

test('Kiro adapter uses the v1 SessionStart and Stop schema', () => {
  const manifest = readJson('integrations/kiro/agentic-swe-memory.json');
  assert.equal(manifest.version, 'v1');
  assert.deepEqual(manifest.hooks.map((hook) => hook.trigger), ['SessionStart', 'Stop']);
});

test('VS Code extension JavaScript passes syntax validation', () => {
  const result = spawnSync(
    process.execPath,
    ['--check', path.join(root, 'integrations/vscode/extension.js')],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});

test('memory MCP fallback initializes and lists all lifecycle tools', () => {
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'agentic_swe_memory_status', arguments: { projectRoot: '/' } },
    },
  ];
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/mcp-memory-server.cjs')],
    {
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-mcp-')),
      input: `${requests.map(JSON.stringify).join('\n')}\n`,
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const responses = result.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(responses[0].result.serverInfo.name, 'agentic-swe-memory');
  assert.equal(responses[0].result.protocolVersion, '2025-06-18');
  assert.deepEqual(
    responses[1].result.tools.map((tool) => tool.name),
    [
      'agentic_swe_memory_refresh',
      'agentic_swe_memory_prime',
      'agentic_swe_memory_status',
    ],
  );
  assert.equal(responses[2].error.code, -32602);
});
