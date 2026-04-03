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
  assert.match(r.stdout, /agentic-swe \d+\.\d+\.\d+/);
});

test('cli --version prints semver', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const r = spawnSync(process.execPath, [binPath, '--version'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stdout.trim(), pkg.version);
});

test('cli doctor on empty temp dir fails (pipeline not installed)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-doc-'));
  const r = spawnSync(process.execPath, [binPath, 'doctor', dir], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /Pipeline not installed/i);
});

test('cli doctor after install succeeds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-doc-'));
  const inst = runInstall(dir);
  assert.strictEqual(inst.status, 0, inst.stderr || inst.stdout);
  const r = spawnSync(process.execPath, [binPath, 'doctor', dir], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Pipeline present/i);
});

test('cli --dry-run exits 0 without creating .claude', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-dry-'));
  const r = spawnSync(process.execPath, [binPath, '-y', '-n', dir], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /DRY RUN/i);
  assert.ok(!fs.existsSync(path.join(dir, '.claude')), 'dry-run must not create .claude');
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

const EXPECTED_SUBTREES = ['commands', 'phases', 'agents', 'templates', 'references', 'tools'];

test('install copies ALL expected subtrees into .claude/', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-sub-'));
  const r = runInstall(dir);
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  for (const sub of EXPECTED_SUBTREES) {
    const target = path.join(dir, '.claude', sub);
    assert.ok(fs.existsSync(target), `expected .claude/${sub} to exist after install`);
    const entries = fs.readdirSync(target);
    assert.ok(entries.length > 0, `.claude/${sub} should not be empty`);
  }
});

test('install creates .work/.gitkeep', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-wk-'));
  const r = runInstall(dir);
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  const gitkeep = path.join(dir, '.claude', '.work', '.gitkeep');
  assert.ok(fs.existsSync(gitkeep), '.work/.gitkeep must exist after install');
});

test('error: target directory does not exist', () => {
  const missing = path.join(os.tmpdir(), 'agentic-swe-noexist-' + Date.now());
  const r = spawnSync(process.execPath, [binPath, '-y', missing], {
    encoding: 'utf8',
    cwd: repoRoot,
  });
  assert.notStrictEqual(r.status, 0, 'should fail for missing directory');
  assert.match(r.stderr, /does not exist/i);
});
