'use strict';

/**
 * Integration tests for bin/agentic-swe.js: install into a temp directory,
 * assert .claude layout and CLAUDE.md merge behavior.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const repoRoot = path.join(__dirname, '..');
const binPath = path.join(repoRoot, 'bin', 'agentic-swe.js');

const DELIMITER =
  '<!-- BEGIN autonomous-swe-pipeline policy -- do not edit above this line -->';

function runInstall(targetDir) {
  return spawnSync(process.execPath, [binPath, '-y', targetDir], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
}

test('cli --help exits 0 and prints usage', () => {
  const r = spawnSync(process.execPath, [binPath, '--help'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Usage:/i);
});

test('install creates .claude/commands with markdown commands', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-test-'));
  const r = runInstall(dir);
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  const commandsDir = path.join(dir, '.claude', 'commands');
  assert.ok(fs.existsSync(commandsDir), 'expected .claude/commands');
  const mdFiles = fs.readdirSync(commandsDir).filter((f) => f.endsWith('.md'));
  assert.ok(mdFiles.length > 0, 'expected at least one command .md');
});

test('install creates CLAUDE.md from package when missing (full copy, no merge)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-test-'));
  const r = runInstall(dir);
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  const claudeMd = path.join(dir, 'CLAUDE.md');
  assert.ok(fs.existsSync(claudeMd));
  const body = fs.readFileSync(claudeMd, 'utf8');
  // Installer uses copyFileSync for missing CLAUDE.md — same content as package root (no delimiter yet).
  assert.match(body, /Orchestrator Policy/);
  assert.match(body, /## State Machine/);
});

test('install appends policy to existing CLAUDE.md without pipeline block', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-test-'));
  const existing = '# My App\n\nLocal notes here.\n';
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), existing);
  const r = runInstall(dir);
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  const body = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.ok(body.includes('Local notes here.'), 'preserves original content');
  assert.match(body, /BEGIN autonomous-swe-pipeline policy/);
});

test('install replaces policy block when delimiter already present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-test-'));
  const oldPolicy = 'UNIQUE_OLD_POLICY_MARKER_SHOULD_BE_REMOVED';
  const existing = `# Title\n\n${DELIMITER}\n\n${oldPolicy}\n`;
  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), existing);
  const r = runInstall(dir);
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  const body = fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8');
  assert.ok(!body.includes(oldPolicy), 'old policy should be replaced');
  assert.match(body, /Orchestrator Policy/);
  assert.ok(body.startsWith('# Title'), 'content before delimiter preserved');
});
