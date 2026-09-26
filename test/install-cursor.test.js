'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { setup } = require('../scripts/setup.cjs');

function gitRepository(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-cursor-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '-q', directory]).status, 0);
  return directory;
}

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-cursor-home-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function minimalPackRoot(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-cursor-pack-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'CLAUDE.md'), '# clean policy\n');
  fs.writeFileSync(path.join(directory, 'AGENTS.md'), '# clean agents\n');
  fs.writeFileSync(path.join(directory, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(directory, 'state-machine.json'), '{}\n');
  fs.mkdirSync(path.join(directory, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'commands', 'work.md'), '# work\n');
  fs.mkdirSync(path.join(directory, 'phases'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'phases', 'implementation.md'), '# implementation\n');
  fs.mkdirSync(path.join(directory, 'schemas'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'schemas', 'state.json'), '{}\n');
  fs.mkdirSync(path.join(directory, 'templates'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'templates', 'evidence.md'), '# evidence\n');
  fs.mkdirSync(path.join(directory, 'hooks', 'session-start'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'hooks', 'session-start', 'run.sh'), '#!/bin/sh\necho hi\n');
  fs.mkdirSync(path.join(directory, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'scripts', 'work-engine.cjs'), '// engine\n');
  // Non-minimal-profile content that must NOT be copied to the Cursor destination when the
  // resolved profile is "minimal": config/jev.default.json and agents/.
  fs.mkdirSync(path.join(directory, 'config'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'config', 'jev.default.json'), '{}\n');
  fs.mkdirSync(path.join(directory, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'agents', 'generalist.md'), '# agent\n');
  return directory;
}

test('installCursor copies the resolved profile, not always the full portable pack', (t) => {
  const target = gitRepository(t);
  const packRoot = minimalPackRoot(t);
  const home = temporaryDirectory(t);

  setup({
    hosts: ['cursor'], target, dryRun: false, gitignore: false, yes: true, allowNonGit: false,
    profile: 'minimal',
  }, { packRoot, home, skipDependencyInstall: true });

  const destination = path.join(home, '.cursor', 'plugins', 'local', 'agentic-swe');
  assert.ok(fs.existsSync(path.join(destination, 'commands', 'work.md')));
  assert.ok(fs.existsSync(path.join(destination, 'scripts', 'work-engine.cjs')));
  // Not part of the minimal profile: must be absent from the Cursor destination.
  assert.equal(fs.existsSync(path.join(destination, 'config', 'jev.default.json')), false);
  assert.equal(fs.existsSync(path.join(destination, 'agents')), false);
});

test('installCursor writes install-state.json inside the Cursor plugin destination', (t) => {
  const target = gitRepository(t);
  const packRoot = minimalPackRoot(t);
  const home = temporaryDirectory(t);

  setup({
    hosts: ['cursor'], target, dryRun: false, gitignore: false, yes: true, allowNonGit: false,
    profile: 'minimal',
  }, { packRoot, home, skipDependencyInstall: true });

  const destination = path.join(home, '.cursor', 'plugins', 'local', 'agentic-swe');
  const manifestPath = path.join(destination, 'install-state.json');
  assert.ok(fs.existsSync(manifestPath));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.host, 'cursor');
  assert.equal(manifest.profile, 'minimal');
  assert.ok(manifest.files.some((file) => file.path === 'commands/work.md'));
});

test('setup still refuses to replace a Cursor plugin that is a git checkout', (t) => {
  const target = gitRepository(t);
  const packRoot = minimalPackRoot(t);
  const home = temporaryDirectory(t);
  const plugin = path.join(home, '.cursor', 'plugins', 'local', 'agentic-swe');
  fs.mkdirSync(path.join(plugin, '.git'), { recursive: true });

  assert.throws(
    () => setup({
      hosts: ['cursor'], target, dryRun: false, gitignore: false, yes: true, allowNonGit: false,
    }, { packRoot, home, skipDependencyInstall: true }),
    /git checkout/,
  );
  assert.ok(fs.existsSync(path.join(plugin, '.git')));
  assert.equal(fs.existsSync(path.join(plugin, 'install-state.json')), false);
});
