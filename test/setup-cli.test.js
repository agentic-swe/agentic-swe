'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseArgs,
  configureOpenCode,
  setup,
} = require('../scripts/setup.cjs');

const packRoot = path.resolve(__dirname, '..');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-setup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('parseArgs supports repeated hosts and target paths', () => {
  const options = parseArgs([
    '--host', 'codex',
    '--host', 'opencode',
    '--target', '.',
    '--no-gitignore',
    '--yes',
  ]);
  assert.deepEqual(options.hosts, ['codex', 'opencode']);
  assert.equal(options.target, process.cwd());
  assert.equal(options.gitignore, false);
});

test('setup installs a portable pack for Codex and OpenCode', (t) => {
  const target = temporaryDirectory(t);
  fs.writeFileSync(path.join(target, 'AGENTS.md'), 'keep my project instructions\n');

  const result = setup(
    { hosts: ['codex', 'opencode'], target, dryRun: false, gitignore: true },
    { packRoot, home: temporaryDirectory(t), skipDependencyInstall: true },
  );

  assert.deepEqual(result.hosts, ['codex', 'opencode']);
  assert.match(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), /Hypervisor Policy/);
  assert.equal(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8'), 'keep my project instructions\n');
  assert.equal(fs.readFileSync(path.join(target, '.gitignore'), 'utf8'), '.worklogs/\n');
  assert.ok(fs.existsSync(path.join(target, '.agentic-swe', 'phases')));
  assert.ok(fs.existsSync(path.join(target, '.agentic-swe', '.opencode', 'plugins', 'agentic-swe.js')));

  const config = JSON.parse(fs.readFileSync(path.join(target, 'opencode.json'), 'utf8'));
  assert.deepEqual(config.plugins, [{
    name: 'agentic-swe',
    entry: '.agentic-swe/.opencode/plugins/agentic-swe.js',
  }]);
});

test('configureOpenCode updates an existing agentic-swe entry without duplicates', (t) => {
  const target = temporaryDirectory(t);
  fs.writeFileSync(path.join(target, 'opencode.json'), JSON.stringify({
    plugins: [{ name: 'agentic-swe', entry: 'old.js' }, 'another-plugin'],
  }));

  configureOpenCode(target, false);

  const config = JSON.parse(fs.readFileSync(path.join(target, 'opencode.json'), 'utf8'));
  assert.equal(config.plugins.length, 2);
  assert.equal(config.plugins[0].entry, '.agentic-swe/.opencode/plugins/agentic-swe.js');
});

test('dry-run reports changes without writing files', (t) => {
  const target = temporaryDirectory(t);
  const result = setup(
    { hosts: ['cursor', 'codex'], target, dryRun: true, gitignore: true },
    { packRoot, home: temporaryDirectory(t), skipDependencyInstall: true },
  );

  assert.ok(result.changes.some((change) => change.startsWith('Would merge policy')));
  assert.deepEqual(fs.readdirSync(target), []);
});
