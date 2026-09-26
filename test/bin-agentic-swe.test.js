const test = require('node:test');
const assert = require('node:assert');
const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'agentic-swe.cjs');
const FIXTURE = path.join(__dirname, 'fixtures', 'receipt', 'lean-happy');

test('bin — version prints semver', () => {
  const out = execFileSync('node', [BIN, 'version'], { encoding: 'utf8' });
  assert.match(out.trim(), /^\d+\.\d+\.\d+/);
});

test('bin — path prints pack root containing CLAUDE.md', () => {
  const out = execFileSync('node', [BIN, 'path'], { encoding: 'utf8' });
  const root = out.trim();
  assert.ok(path.isAbsolute(root), 'pack root should be absolute');
  const fs = require('node:fs');
  assert.ok(fs.existsSync(path.join(root, 'CLAUDE.md')), 'pack root should contain CLAUDE.md');
});

test('bin — receipt subcommand re-execs render-receipt.cjs', () => {
  const out = execFileSync('node', [BIN, 'receipt', '--work-dir', FIXTURE], { encoding: 'utf8' });
  assert.match(out, /# \/work/);
  assert.match(out, /add-retry-logic/);
});

test('bin — receipt subcommand --format=json passes flags through', () => {
  const out = execFileSync('node', [BIN, 'receipt', '--work-dir', FIXTURE, '--format=json'], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.workId, 'add-retry-logic');
});

test('bin — receipt subcommand propagates non-zero exit on bad work dir', () => {
  const res = spawnSync('node', [BIN, 'receipt', '--work-dir', '/tmp/does-not-exist-9999'], { encoding: 'utf8' });
  assert.notEqual(res.status, 0);
});

test('bin — help mentions receipt subcommand', () => {
  const res = spawnSync('node', [BIN, 'help'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.match(res.stderr, /receipt/);
});

test('bin — help lists scan, list-installed, repair, update, and uninstall', () => {
  const res = spawnSync('node', [BIN, 'help'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  for (const command of ['scan', 'list-installed', 'repair', 'update', 'uninstall']) {
    assert.match(res.stderr, new RegExp(`\\b${command}\\b`), `expected help to mention "${command}"`);
  }
});
