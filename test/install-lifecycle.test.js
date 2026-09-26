'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { sha256Text } = require('../scripts/lib/install-state/hash.cjs');
const { writeManifest } = require('../scripts/lib/install-state/manifest.cjs');
const { repair, uninstall, updateInstalled } = require('../scripts/lib/install-state/lifecycle.cjs');

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'install-life-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('repair adopts an exact match and preserves a modified file', (t) => {
  const destination = tempDir(t);
  const packRoot = tempDir(t);
  fs.mkdirSync(path.join(packRoot, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'commands/work.md'), 'shipped\n');
  fs.mkdirSync(path.join(destination, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'commands/work.md'), 'shipped\n');
  fs.writeFileSync(path.join(destination, 'notes.md'), 'local\n');
  const result = repair({
    destination,
    packRoot,
    packFiles: new Map([['commands/work.md', sha256Text('shipped\n')]]),
    dryRun: false,
  });
  assert.deepEqual(result.adoptable, []);
  assert.ok(result.preserved.includes('notes.md'));
  assert.equal(fs.existsSync(path.join(destination, 'notes.md')), true);
});

test('repair reports an individual unreadable file and continues with the rest', { skip: process.getuid && process.getuid() === 0 }, (t) => {
  const destination = tempDir(t);
  const packRoot = tempDir(t);
  fs.mkdirSync(path.join(packRoot, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'commands/work.md'), 'shipped\n');
  fs.mkdirSync(path.join(destination, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'commands/work.md'), 'shipped\n');
  const unreadable = path.join(destination, 'commands', 'locked.md');
  fs.writeFileSync(unreadable, 'secret\n');
  fs.chmodSync(unreadable, 0o000);

  let result;
  try {
    result = repair({
      destination,
      packRoot,
      packFiles: new Map([['commands/work.md', sha256Text('shipped\n')]]),
      dryRun: false,
    });
  } finally {
    // Directory write permission (not the file's own mode) governs unlink, so this is only
    // needed so later assertions/inspection tools can still open the file if desired.
    fs.chmodSync(unreadable, 0o644);
  }

  assert.ok(result.unreadable.some((entry) => entry.path === 'commands/locked.md'));
  assert.ok(result.changes.some((change) => change.includes('commands/locked.md')));
  // The rest of the destination is still classified and repaired normally: the exact-hash
  // match was adopted into the manifest and now reports as current, not left unclassified.
  assert.deepEqual(result.current, ['commands/work.md']);
  assert.equal(fs.existsSync(path.join(destination, 'commands/work.md')), true);
});

test('update refreshes a drifted owned file and uninstall preserves drift', (t) => {
  const destination = tempDir(t);
  const packRoot = tempDir(t);
  fs.mkdirSync(path.join(packRoot, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(destination, 'commands'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'commands/work.md'), 'new\n');
  fs.writeFileSync(path.join(destination, 'commands/work.md'), 'old\n');
  writeManifest(destination, {
    schema_version: 1, installer_version: '3.3.1', host: 'codex', profile: 'core',
    files: [{ path: 'commands/work.md', sha256: sha256Text('old\n') }],
    edits: [], external_registrations: [],
    last_scan: { status: 'clean', critical: 0, high: 0, medium: 0, low: 0, receipt: null },
  });
  updateInstalled({
    destination, packRoot,
    packFiles: new Map([['commands/work.md', sha256Text('new\n')]]),
    dryRun: false,
  });
  assert.equal(fs.readFileSync(path.join(destination, 'commands/work.md'), 'utf8'), 'new\n');
  fs.writeFileSync(path.join(destination, 'commands/work.md'), 'edited\n');
  const removed = uninstall({ destination, dryRun: false });
  assert.equal(fs.readFileSync(path.join(destination, 'commands/work.md'), 'utf8'), 'edited\n');
  assert.deepEqual(removed.drifted, ['commands/work.md']);
});
