'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { inspect } = require('../scripts/doctor.cjs');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-tool-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('doctor reports required pack and project checks', (t) => {
  const target = temporaryDirectory(t);
  fs.writeFileSync(path.join(target, 'CLAUDE.md'), '# policy\n');
  fs.writeFileSync(path.join(target, '.gitignore'), '.worklogs/\n');

  const result = inspect(
    { target },
    { packRoot: path.resolve(__dirname, '..'), home: temporaryDirectory(t) },
  );

  assert.equal(result.ok, true);
  assert.equal(result.checks.find((check) => check.name === 'Project policy').ok, true);
  assert.equal(result.checks.find((check) => check.name === 'Worklog ignore').ok, true);
});

function unixFixture(t) {
  const root = temporaryDirectory(t);
  const fixture = path.join(root, 'agentic-swe-fixture');
  const fakeBin = path.join(root, 'fake-bin');
  fs.mkdirSync(path.join(fixture, 'bin'), { recursive: true });
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fixture, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
  fs.writeFileSync(
    path.join(fixture, 'bin', 'agentic-swe.cjs'),
    '#!/usr/bin/env node\nconsole.log("fixture tool")\n',
  );
  fs.writeFileSync(path.join(fakeBin, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const archive = path.join(root, 'fixture.tar.gz');
  const packed = spawnSync('tar', ['-czf', archive, '-C', root, path.basename(fixture)]);
  assert.equal(packed.status, 0, packed.stderr?.toString());
  const sha256 = require('node:crypto').createHash('sha256').update(fs.readFileSync(archive)).digest('hex');

  const installDir = path.join(root, 'installed');
  const binDir = path.join(root, 'bin');
  const run = (extraEnv = {}) =>
    spawnSync('bash', [path.resolve(__dirname, '..', 'install.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        AGENTIC_SWE_ARCHIVE_URL: `file://${archive}`,
        AGENTIC_SWE_HOME: installDir,
        AGENTIC_SWE_BIN_DIR: binDir,
        AGENTIC_SWE_SHA256: '',
        ...extraEnv,
      },
    });
  return { run, sha256, installDir, binDir };
}

test('Unix installer creates a runnable durable command', { skip: process.platform === 'win32' }, (t) => {
  const { run, binDir } = unixFixture(t);
  const installed = run();
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stderr, /download not verified/);

  const executed = spawnSync(path.join(binDir, 'agentic-swe'), [], { encoding: 'utf8' });
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(executed.stdout.trim(), 'fixture tool');
});

test('Unix installer verifies AGENTIC_SWE_SHA256 before extracting', { skip: process.platform === 'win32' }, (t) => {
  const { run, sha256, binDir } = unixFixture(t);
  const installed = run({ AGENTIC_SWE_SHA256: sha256.toUpperCase() });
  assert.equal(installed.status, 0, installed.stderr);
  assert.match(installed.stdout, new RegExp(`Verified SHA-256 ${sha256}`));
  assert.ok(fs.existsSync(path.join(binDir, 'agentic-swe')));
});

test('Unix installer refuses a SHA-256 mismatch and installs nothing', { skip: process.platform === 'win32' }, (t) => {
  const { run, installDir, binDir } = unixFixture(t);
  const refused = run({ AGENTIC_SWE_SHA256: '0'.repeat(64) });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /SHA-256 mismatch/);
  assert.equal(fs.existsSync(installDir), false);
  assert.equal(fs.existsSync(path.join(binDir, 'agentic-swe')), false);
});

test('installers pin a checksum to the default ref and verify before extracting', () => {
  const root = path.resolve(__dirname, '..');
  const sh = fs.readFileSync(path.join(root, 'install.sh'), 'utf8');
  assert.match(sh, /^DEFAULT_REF="[^"]+"$/m);
  assert.match(sh, /^DEFAULT_SHA256="[0-9a-f]*"$/m);
  assert.ok(sh.indexOf('SHA-256 mismatch') < sh.indexOf('tar -xzf'), 'install.sh verifies before tar');

  const ps = fs.readFileSync(path.join(root, 'install.ps1'), 'utf8');
  assert.match(ps, /^\$DefaultRef = "[^"]+"$/m);
  assert.match(ps, /^\$DefaultSha256 = "[0-9a-f]*"$/m);
  assert.match(ps, /Get-FileHash -Algorithm SHA256/);
  assert.ok(ps.indexOf('SHA-256 mismatch') < ps.indexOf('Expand-Archive'), 'install.ps1 verifies before Expand-Archive');

  const shRef = sh.match(/^DEFAULT_REF="([^"]+)"$/m)[1];
  const psRef = ps.match(/^\$DefaultRef = "([^"]+)"$/m)[1];
  assert.equal(shRef, psRef, 'both installers default to the same ref');
  if (shRef !== 'main') {
    assert.match(sh, /^DEFAULT_SHA256="[0-9a-f]{64}"$/m, 'a release tag default needs its .tar.gz checksum');
    assert.match(ps, /^\$DefaultSha256 = "[0-9a-f]{64}"$/m, 'a release tag default needs its .zip checksum');
  }
});
