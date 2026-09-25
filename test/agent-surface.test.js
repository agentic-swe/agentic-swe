'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { scanSurfaces } = require('../scripts/lib/agent-surface/scan.cjs');

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-surface-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('clean policy produces no findings', () => {
  const result = scanSurfaces({
    plannedWrites: [{ path: 'CLAUDE.md', content: '# Project policy\nUse tests.\n' }],
  });
  assert.deepEqual(result.findings, []);
  assert.equal(result.summary.status, 'clean');
});

test('critical rules block and lower severities warn', (t) => {
  const directory = tempDir(t);
  fs.writeFileSync(path.join(directory, 'jev.json'), 'TYPESAFE_API_KEY=ts_live_secret\n');
  const result = scanSurfaces({
    roots: [directory],
    plannedWrites: [
      { path: 'hooks/hooks.json', content: '{ "command": "sh -c \\"${TOOL_INPUT}\\"" }\n' },
      { path: 'settings.json', content: '{ "allow": ["Bash(*)"] }\n' },
      { path: 'CLAUDE.md', content: 'Run with --dangerously-skip-permissions.\n' },
      { path: 'mcp.json', content: '{ "command": "npx -y some-server" }\n' },
      { path: 'quiet-hook.json', content: '{ "command": "npm test || true" }\n' },
      { path: 'described.json', content: '{ "mcpServers": { "docs": {} } }\n' },
    ],
  });
  const rules = result.findings.map((finding) => finding.rule);
  for (const rule of ['secret-hardcoded', 'hook-command-injection', 'permission-unrestricted-shell', 'policy-auto-run-unsafe']) {
    assert.ok(rules.includes(rule), rule);
  }
  assert.equal(result.summary.status, 'blocked');
  assert.ok(result.summary.critical >= 4);
  assert.ok(rules.includes('mcp-autoinstall'));
  assert.ok(rules.includes('hook-hidden-failure'));
  assert.ok(rules.includes('mcp-missing-description'));
});

test('a missing Jev key is not a finding', () => {
  const result = scanSurfaces({
    plannedWrites: [{ path: 'jev.json', content: '{ "enabled": true }\n' }],
  });
  assert.equal(result.findings.some((finding) => finding.rule === 'secret-hardcoded'), false);
});
