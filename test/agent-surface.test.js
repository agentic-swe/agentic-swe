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

test('non-critical findings yield warnings status and full finding fields', () => {
  const result = scanSurfaces({
    plannedWrites: [
      { path: 'mcp.json', content: '{ "command": "npx -y some-server" }\n' },
      { path: 'quiet-hook.json', content: '{ "command": "npm test || true" }\n' },
      { path: 'described.json', content: '{ "mcpServers": { "docs": {} } }\n' },
    ],
  });
  assert.equal(result.summary.status, 'warnings');
  assert.equal(result.summary.critical, 0);
  assert.ok(result.findings.length > 0);
  const finding = result.findings.find((item) => item.rule === 'mcp-autoinstall');
  assert.ok(finding, 'expected mcp-autoinstall finding');
  assert.match(finding.id, /^mcp-autoinstall:mcp\.json:\d+$/);
  assert.equal(finding.rule, 'mcp-autoinstall');
  assert.equal(finding.severity, 'high');
  assert.equal(finding.path, 'mcp.json');
  assert.equal(finding.line, 1);
  assert.ok(finding.evidence.includes('npx -y'));
  assert.match(finding.message, /mcp-autoinstall at mcp\.json:1/);
});

test('scanning the scanner source itself does not self-trigger policy-auto-run-unsafe', () => {
  const scanSourcePath = path.join(__dirname, '..', 'scripts', 'lib', 'agent-surface', 'scan.cjs');
  const content = fs.readFileSync(scanSourcePath, 'utf8');
  // The rule definition's own source must not contain the contiguous flag/phrase it detects
  // (they must be assembled from parts at runtime), otherwise scanning this trusted
  // control-plane file as planned install content would block every install.
  assert.equal(content.includes('--dangerously-skip-permissions'), false);
  assert.equal(content.includes('bypass permission prompts'), false);
  const result = scanSurfaces({
    plannedWrites: [{ path: 'scripts/lib/agent-surface/scan.cjs', content }],
  });
  assert.equal(
    result.findings.some((finding) => finding.rule === 'policy-auto-run-unsafe'),
    false,
  );
});

test('a real occurrence of the dangerous flag elsewhere under agent-surface/ is still blocked', () => {
  const flag = ['--dangerously', 'skip', 'permissions'].join('-');
  const result = scanSurfaces({
    plannedWrites: [
      { path: 'scripts/lib/agent-surface/example-usage.md', content: `Run with ${flag} once.\n` },
    ],
  });
  assert.ok(result.findings.some((finding) => finding.rule === 'policy-auto-run-unsafe'));
  assert.equal(result.summary.status, 'blocked');
});
