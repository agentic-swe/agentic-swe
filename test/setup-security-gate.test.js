'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { parseArgs, setup } = require('../scripts/setup.cjs');
const { beginTransaction, recordCreated, rollback } = require('../scripts/lib/install-state/transaction.cjs');

function gitRepository(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '-q', directory]).status, 0);
  return directory;
}

function temporaryPackRoot(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-gate-pack-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(directory, 'CLAUDE.md'),
    '# test pack\n--dangerously-skip-permissions\n',
  );
  fs.writeFileSync(path.join(directory, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(directory, 'AGENTS.md'), '# test agents\n');
  return directory;
}

/** A pack whose top-level files are clean; the only critical content is nested under hooks/. */
function packRootWithNestedCriticalHook(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-gate-nested-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'CLAUDE.md'), '# clean top-level policy\n');
  fs.writeFileSync(path.join(directory, 'package.json'), '{}\n');
  fs.writeFileSync(path.join(directory, 'AGENTS.md'), '# clean top-level agents\n');
  fs.mkdirSync(path.join(directory, 'hooks', 'nested'), { recursive: true });
  fs.writeFileSync(
    path.join(directory, 'hooks', 'nested', 'inject.json'),
    '{ "command": "sh -c \\"${TOOL_INPUT}\\"" }\n',
  );
  return directory;
}

test('parseArgs records the risk reason', () => {
  assert.equal(parseArgs(['--accept-risk', 'reviewed hook']).acceptRisk, 'reviewed hook');
  assert.throws(() => parseArgs(['--accept-risk']), /--accept-risk requires a reason/);
});

test('critical planned content blocks setup before writing', (t) => {
  const target = gitRepository(t);
  const packRoot = temporaryPackRoot(t);
  assert.throws(() => setup({
    hosts: ['codex'], target, dryRun: false, gitignore: false, yes: true, allowNonGit: false,
  }, { packRoot, home: path.join(target, 'empty-home'), skipDependencyInstall: true   }), /critical agent-surface findings/);
  assert.equal(fs.existsSync(path.join(target, 'CLAUDE.md')), false);
  assert.equal(fs.existsSync(path.join(target, '.agentic-swe')), false);
  assert.equal(fs.existsSync(path.join(target, '.agentic-swe', 'install-state.json')), false);
});

test('acceptRisk writes an install receipt for critical findings', (t) => {
  const target = gitRepository(t);
  const packRoot = temporaryPackRoot(t);
  const reason = 'reviewed critical marker for automated test';
  setup({
    hosts: ['codex'],
    target,
    dryRun: false,
    gitignore: false,
    yes: true,
    allowNonGit: false,
    acceptRisk: reason,
  }, { packRoot, home: path.join(target, 'empty-home'), skipDependencyInstall: true });

  const receiptsDir = path.join(target, '.agentic-swe', 'install-receipts');
  const receiptFiles = fs.readdirSync(receiptsDir).filter((name) => name.endsWith('.json'));
  assert.ok(receiptFiles.length >= 1);
  const receipt = JSON.parse(fs.readFileSync(path.join(receiptsDir, receiptFiles[0]), 'utf8'));
  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.command, 'setup');
  assert.equal(receipt.reason, reason);
});

test('rollback deletes only transaction-recorded paths', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-gate-tx-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const keepPath = path.join(directory, 'keep.txt');
  const removePath = path.join(directory, 'remove.txt');
  fs.writeFileSync(keepPath, 'stay');
  fs.writeFileSync(removePath, 'go');
  const transaction = beginTransaction();
  recordCreated(transaction, removePath);
  rollback(transaction);
  assert.equal(fs.existsSync(keepPath), true);
  assert.equal(fs.existsSync(removePath), false);
});

test('setup rollback removes portable files after a post-copy failure', (t) => {
  const target = gitRepository(t);
  const packRoot = temporaryPackRoot(t);
  const recordedRelative = path.join('.agentic-swe', 'package.json');
  const recordedPath = path.join(target, recordedRelative);
  assert.throws(() => setup({
    hosts: ['codex', 'antigravity'],
    target,
    dryRun: false,
    gitignore: false,
    yes: true,
    allowNonGit: false,
    acceptRisk: 'exercise rollback after portable install',
  }, { packRoot, home: path.join(target, 'empty-home'), skipDependencyInstall: true }), /GEMINI\.md/);
  assert.equal(fs.existsSync(recordedPath), false);
});

test('critical content nested under a planned directory (hooks/) blocks setup and writes nothing', (t) => {
  const target = gitRepository(t);
  const packRoot = packRootWithNestedCriticalHook(t);
  assert.throws(() => setup({
    hosts: ['codex'], target, dryRun: false, gitignore: false, yes: true, allowNonGit: false,
  }, { packRoot, home: path.join(target, 'empty-home'), skipDependencyInstall: true }), /critical agent-surface findings/);
  assert.equal(fs.existsSync(path.join(target, 'CLAUDE.md')), false);
  assert.equal(fs.existsSync(path.join(target, '.agentic-swe')), false);
});

test('accepted risk records last_scan.status as accepted-risk with the reason and critical findings', (t) => {
  const target = gitRepository(t);
  const packRoot = temporaryPackRoot(t);
  const reason = 'reviewed critical marker for automated test';
  setup({
    hosts: ['codex'],
    target,
    dryRun: false,
    gitignore: false,
    yes: true,
    allowNonGit: false,
    acceptRisk: reason,
  }, { packRoot, home: path.join(target, 'empty-home'), skipDependencyInstall: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(target, '.agentic-swe', 'install-state.json'), 'utf8'));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.last_scan.status, 'accepted-risk');
  assert.ok(manifest.last_scan.critical >= 1);
  assert.ok(manifest.last_scan.receipt);

  const receipt = JSON.parse(fs.readFileSync(
    path.join(target, '.agentic-swe', manifest.last_scan.receipt),
    'utf8',
  ));
  assert.equal(receipt.reason, reason);
  assert.ok(receipt.findings.length >= 1);
  assert.ok(receipt.findings.every((finding) => finding.severity === 'critical'));
});

test('gateSetup scans only the install destination and planned writes, not the whole target repo', (t) => {
  const target = gitRepository(t);
  const packRoot = temporaryPackRoot(t);
  fs.writeFileSync(path.join(packRoot, 'CLAUDE.md'), '# clean pack\n');
  // Unrelated pre-existing doc elsewhere in the target repository, outside the install
  // destination and outside every planned write. It must not false-block setup.
  fs.writeFileSync(
    path.join(target, 'unrelated-notes.md'),
    'Run with --dangerously-skip-permissions for local debugging.\n',
  );
  const result = setup({
    hosts: ['codex'], target, dryRun: false, gitignore: false, yes: true, allowNonGit: false,
  }, { packRoot, home: path.join(target, 'empty-home'), skipDependencyInstall: true });
  assert.ok(fs.existsSync(path.join(target, '.agentic-swe', 'install-state.json')));
  const manifest = JSON.parse(fs.readFileSync(path.join(target, '.agentic-swe', 'install-state.json'), 'utf8'));
  assert.equal(manifest.last_scan.status, 'clean');
  assert.ok(result.changes.length > 0);
});

test('a failed copy after a risk receipt is written rolls back the receipt and its directory', (t) => {
  const target = gitRepository(t);
  const packRoot = temporaryPackRoot(t);
  const receiptsDir = path.join(target, '.agentic-swe', 'install-receipts');
  assert.throws(() => setup({
    hosts: ['codex', 'antigravity'],
    target,
    dryRun: false,
    gitignore: false,
    yes: true,
    allowNonGit: false,
    acceptRisk: 'exercise receipt rollback after a later copy failure',
  }, { packRoot, home: path.join(target, 'empty-home'), skipDependencyInstall: true }), /GEMINI\.md/);
  assert.equal(fs.existsSync(receiptsDir), false);
  assert.equal(fs.existsSync(path.join(target, '.agentic-swe', 'install-state.json')), false);
});
