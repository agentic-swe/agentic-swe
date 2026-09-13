'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mineGitProcedures } = require('../scripts/lib/descent/mine-git-procedures.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('mine git procedures', () => {
  it('evaluates isolated node --test files that co-changed with source in git history', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-mine-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'test'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'hit.js'), 'module.exports = 1;\n');
    fs.writeFileSync(
      path.join(tmp, 'test', 'hit.test.js'),
      `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
test('hit', () => assert.equal(require('../src/hit.js'), 1));
`
    );
    const git = (args) => spawnSync('git', args, { cwd: tmp, encoding: 'utf8' });
    assert.equal(git(['init']).status, 0);
    git(['add', '.']);
    const commit = spawnSync(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'add hit test'],
      { cwd: tmp, encoding: 'utf8' }
    );
    assert.equal(commit.status, 0, commit.stderr);
    const r = mineGitProcedures({ projectRoot: tmp, pluginRoot, maxCommits: 5, limit: 4 });
    assert.equal(r.ok, true);
    assert.ok(r.procedures >= 1, JSON.stringify(r));
    const store = JSON.parse(fs.readFileSync(path.join(tmp, '.agentic-swe', 'procedures.json'), 'utf8'));
    const rec = store.procedures.find((p) => p.procedure?._meta?.source === 'git-history');
    assert.ok(rec);
    assert.equal(rec.eval_status, 'evaluated');
    assert.match(rec.procedure.verify[0].command, /node --test test\/hit\.test\.js/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes procedures to storeRoot without mutating projectRoot store', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-store-'));
    const storeRoot = path.join(tmp, 'isolated-store');
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'test'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'hit.js'), 'module.exports = 1;\n');
    fs.writeFileSync(
      path.join(tmp, 'test', 'hit.test.js'),
      `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
test('hit', () => assert.equal(require('../src/hit.js'), 1));
`
    );
    spawnSync('git', ['init'], { cwd: tmp, encoding: 'utf8' });
    spawnSync('git', ['add', '.'], { cwd: tmp, encoding: 'utf8' });
    spawnSync(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'add hit'],
      { cwd: tmp, encoding: 'utf8' }
    );
    const r = mineGitProcedures({
      projectRoot: tmp,
      pluginRoot,
      storeRoot,
      maxCommits: 5,
      limit: 2,
    });
    assert.ok(r.procedures >= 1);
    assert.ok(fs.existsSync(path.join(storeRoot, '.agentic-swe', 'procedures.json')));
    assert.equal(fs.existsSync(path.join(tmp, '.agentic-swe', 'procedures.json')), false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
