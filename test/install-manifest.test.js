'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { sha256Text } = require('../scripts/lib/install-state/hash.cjs');
const {
  classifyDestination,
  isRuntimePath,
  readManifest,
  writeManifest,
} = require('../scripts/lib/install-state/manifest.cjs');

function tempDir(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'install-manifest-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('runtime state is never classifiable as owned content', () => {
  assert.equal(isRuntimePath('jev.json'), true);
  assert.equal(isRuntimePath('skills/local/SKILL.md'), true);
  assert.equal(isRuntimePath('commands/work.md'), false);
});

test('classification separates current, drifted, preserved, and adoptable files', (t) => {
  const destination = tempDir(t);
  const owned = sha256Text('owned\n');
  const shipped = sha256Text('shipped\n');
  fs.mkdirSync(path.join(destination, 'commands'));
  fs.writeFileSync(path.join(destination, 'commands/work.md'), 'owned\n');
  fs.writeFileSync(path.join(destination, 'commands/drift.md'), 'changed\n');
  fs.writeFileSync(path.join(destination, 'commands/same.md'), 'shipped\n');
  fs.writeFileSync(path.join(destination, 'jev.json'), '{}\n');
  writeManifest(destination, {
    schema_version: 1,
    installer_version: '3.3.1',
    host: 'codex',
    profile: 'core',
    files: [
      { path: 'commands/work.md', sha256: owned },
      { path: 'commands/drift.md', sha256: sha256Text('original\n') },
    ],
    edits: [],
    external_registrations: [],
    last_scan: { status: 'clean', critical: 0, high: 0, medium: 0, low: 0, receipt: null },
  });
  const result = classifyDestination({
    destination,
    manifest: readManifest(destination),
    packFiles: new Map([['commands/same.md', shipped]]),
  });
  assert.deepEqual(result.current, ['commands/work.md']);
  assert.deepEqual(result.drifted, ['commands/drift.md']);
  assert.deepEqual(result.adoptable, ['commands/same.md']);
  assert.equal(result.preserved.includes('jev.json'), false);
});

test('invalid manifest JSON throws', (t) => {
  const destination = tempDir(t);
  fs.writeFileSync(path.join(destination, 'install-state.json'), '{');
  assert.throws(() => readManifest(destination), /corrupt manifest/);
});
