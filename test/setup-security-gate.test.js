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
