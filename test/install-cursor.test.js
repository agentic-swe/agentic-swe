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

test('a Cursor-only install never records target-repo edit paths on the plugin manifest', (t) => {
  const target = gitRepository(t);
  const packRoot = minimalPackRoot(t);
  const home = temporaryDirectory(t);

  // Pre-existing target CLAUDE.md (without the policy delimiter) forces mergeClaudePolicy to
  // *append* rather than create, which produces a 'policy-append' edit. A .gitignore without
  // .worklogs/ forces a 'gitignore-line' edit too. Both target files live in the target repo,
  // never inside the Cursor plugin directory.
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# pre-existing project policy\n');
  fs.writeFileSync(path.join(target, '.gitignore'), 'node_modules/\n');

  setup({
    hosts: ['cursor'], target, dryRun: false, gitignore: true, yes: true, allowNonGit: false,
    profile: 'minimal',
  }, { packRoot, home, skipDependencyInstall: true });

  const destination = path.join(home, '.cursor', 'plugins', 'local', 'agentic-swe');
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'install-state.json'), 'utf8'));

  // No <target>/.agentic-swe manifest exists for this Cursor-only install, so host edits must
  // not be smuggled onto the plugin manifest with target-relative paths like "../CLAUDE.md".
  assert.deepEqual(manifest.edits, []);
  assert.deepEqual(manifest.external_registrations, []);

  // Every recorded edit path (defense in depth, should the array ever be non-empty) must
  // resolve inside the plugin directory, matching how uninstall resolves edit paths.
  for (const edit of manifest.edits) {
    const resolved = path.resolve(destination, edit.path);
    assert.ok(
      resolved === destination || resolved.startsWith(`${destination}${path.sep}`),
      `edit path escapes the plugin directory: ${edit.path}`,
    );
  }

  // last_scan.receipt must be null or relative to the plugin directory itself, never a path
  // relative to <target>/.agentic-swe (where the gate-scan receipt, if any, actually lives).
  const { receipt } = manifest.last_scan;
  if (receipt !== null) {
    const resolvedReceipt = path.resolve(destination, receipt);
    assert.ok(
      resolvedReceipt === destination || resolvedReceipt.startsWith(`${destination}${path.sep}`),
      `last_scan.receipt escapes the plugin directory: ${receipt}`,
    );
  }

  // The target repo's own files were still edited correctly — only the manifest tracking of
  // those edits was in question.
  assert.match(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), /pre-existing project policy/);
  assert.match(fs.readFileSync(path.join(target, '.gitignore'), 'utf8'), /\.worklogs\//);
});
