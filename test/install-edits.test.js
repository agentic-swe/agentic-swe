'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { setup } = require('../scripts/setup.cjs');
const { uninstall } = require('../scripts/lib/install-state/lifecycle.cjs');

function gitRepository(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'install-edits-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '-q', directory]).status, 0);
  return directory;
}

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'install-edits-home-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function cleanPackRoot(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'install-edits-pack-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'CLAUDE.md'), '# Hypervisor Policy\n\nUse tests.\n');
  fs.writeFileSync(path.join(directory, 'AGENTS.md'), '# clean agents\n');
  fs.writeFileSync(path.join(directory, 'package.json'), '{}\n');
  return directory;
}

test('setup records CLAUDE.md append and gitignore edits in the shapes uninstall reverses', (t) => {
  const target = gitRepository(t);
  const packRoot = cleanPackRoot(t);
  const home = temporaryDirectory(t);
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# My project\n\nLocal rules.\n');

  setup({
    hosts: ['codex'], target, dryRun: false, gitignore: true, yes: true, allowNonGit: false,
  }, { packRoot, home, skipDependencyInstall: true });

  const destination = path.join(target, '.agentic-swe');
  const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'install-state.json'), 'utf8'));

  const policyEdit = manifest.edits.find((edit) => edit.type === 'policy-append');
  assert.ok(policyEdit, 'expected a policy-append edit');
  assert.equal(policyEdit.path, '../CLAUDE.md');
  assert.equal(typeof policyEdit.body, 'string');
  assert.ok(policyEdit.body.includes('Hypervisor Policy'));
  const claudeContent = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
  assert.ok(claudeContent.endsWith(policyEdit.body));

  const gitignoreEdit = manifest.edits.find((edit) => edit.type === 'gitignore-line');
  assert.ok(gitignoreEdit, 'expected a gitignore-line edit');
  assert.equal(gitignoreEdit.path, '../.gitignore');
  assert.equal(gitignoreEdit.line, '.worklogs/');

  // A newly-created AGENTS.md must stay in files, not edits.
  assert.ok(manifest.files.some((file) => file.path === '../AGENTS.md'));
  assert.equal(manifest.edits.some((edit) => edit.path === '../AGENTS.md'), false);
});

test('uninstall reverses an exact policy-append and preserves the file when bytes no longer match', (t) => {
  const target = gitRepository(t);
  const packRoot = cleanPackRoot(t);
  const home = temporaryDirectory(t);
  const original = '# My project\n\nLocal rules.\n';
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), original);

  setup({
    hosts: ['codex'], target, dryRun: false, gitignore: false, yes: true, allowNonGit: false,
  }, { packRoot, home, skipDependencyInstall: true });

  const destination = path.join(target, '.agentic-swe');
  const appendedContent = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
  assert.notEqual(appendedContent, original);

  const result = uninstall({ destination, dryRun: false });
  assert.ok(result.changes.some((change) => change.includes('../CLAUDE.md')));
  const restored = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
  // applyEdit strips exactly the recorded appended bytes, which is the trimmed original content.
  assert.equal(restored, original.trimEnd());
});

test('uninstall preserves CLAUDE.md when the appended bytes no longer match', (t) => {
  const target = gitRepository(t);
  const packRoot = cleanPackRoot(t);
  const home = temporaryDirectory(t);
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# My project\n\nLocal rules.\n');

  setup({
    hosts: ['codex'], target, dryRun: false, gitignore: false, yes: true, allowNonGit: false,
  }, { packRoot, home, skipDependencyInstall: true });

  const destination = path.join(target, '.agentic-swe');
  // Mutate the appended tail so the recorded edit no longer matches exactly.
  fs.appendFileSync(path.join(target, 'CLAUDE.md'), '\nHand-edited after install.\n');
  const mutated = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');

  const result = uninstall({ destination, dryRun: false });
  assert.ok(result.preserved.includes('../CLAUDE.md'));
  const afterUninstall = fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8');
  assert.equal(afterUninstall, mutated);
});
