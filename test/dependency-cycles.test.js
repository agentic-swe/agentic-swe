const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'dependency-cycles.cjs');
const { findCycles } = require(CLI);

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-cycles-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

test('dependency cycles — the repository has none (ADR-016)', () => {
  const r = findCycles(ROOT);
  assert.deepStrictEqual(r.fileCycles, []);
  assert.deepStrictEqual(r.moduleCycles, []);
  assert.ok(r.files > 100);
});

test('dependency cycles — detects a file cycle, including lazy requires', () => {
  const dir = fixture({
    'scripts/lib/a/x.cjs': "require('./y.cjs');",
    'scripts/lib/a/y.cjs': "function f() { return require('./x'); }",
  });
  assert.deepStrictEqual(findCycles(dir).fileCycles, [['scripts/lib/a/x.cjs', 'scripts/lib/a/y.cjs']]);
});

test('dependency cycles — detects a module cycle without a file cycle', () => {
  const dir = fixture({
    'scripts/lib/a/one.cjs': "require('../b/two.cjs');",
    'scripts/lib/b/two.cjs': '',
    'scripts/lib/b/three.cjs': "require('../a/four.cjs');",
    'scripts/lib/a/four.cjs': '',
  });
  const r = findCycles(dir);
  assert.deepStrictEqual(r.fileCycles, []);
  assert.strictEqual(r.moduleCycles.length, 1);
  assert.deepStrictEqual(r.moduleCycles[0].members, ['scripts/lib/a', 'scripts/lib/b']);
  assert.deepStrictEqual(r.moduleCycles[0].edges, [
    'scripts/lib/a/one.cjs -> scripts/lib/b/two.cjs',
    'scripts/lib/b/three.cjs -> scripts/lib/a/four.cjs',
  ]);
});

test('dependency cycles — CLI exits non-zero on a cycle', () => {
  const dir = fixture({
    'bin/a.cjs': "require('../scripts/b.cjs');",
    'scripts/b.cjs': "require('../bin/a.cjs');",
  });
  const r = spawnSync(process.execPath, [CLI, dir], { encoding: 'utf8' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /file cycle: bin\/a\.cjs, scripts\/b\.cjs/);
  const ok = spawnSync(process.execPath, [CLI, ROOT], { encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, ok.stderr);
});
