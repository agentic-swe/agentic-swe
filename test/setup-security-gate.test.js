'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { parseArgs, setup } = require('../scripts/setup.cjs');

const packRoot = path.resolve(__dirname, '..');

function gitRepository(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '-q', directory]).status, 0);
  return directory;
}

test('parseArgs records the risk reason', () => {
  assert.equal(parseArgs(['--accept-risk', 'reviewed hook']).acceptRisk, 'reviewed hook');
  assert.throws(() => parseArgs(['--accept-risk']), /--accept-risk requires a reason/);
});

test('critical planned content blocks setup before writing', (t) => {
  const target = gitRepository(t);
  const source = path.join(packRoot, 'CLAUDE.md');
  const original = fs.readFileSync(source, 'utf8');
  fs.appendFileSync(source, '\n--dangerously-skip-permissions\n');
  t.after(() => fs.writeFileSync(source, original));
  assert.throws(() => setup({
    hosts: ['codex'], target, dryRun: false, gitignore: false, yes: true, allowNonGit: false,
  }, { packRoot, home: path.join(target, 'empty-home'), skipDependencyInstall: true }), /critical agent-surface findings/);
  assert.equal(fs.existsSync(path.join(target, '.agentic-swe', 'install-state.json')), false);
});
