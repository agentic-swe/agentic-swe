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

test('Unix installer creates a runnable durable command', { skip: process.platform === 'win32' }, (t) => {
  const root = temporaryDirectory(t);
  const fixture = path.join(root, 'agentic-swe-fixture');
  const fakeBin = path.join(root, 'fake-bin');
  const installDir = path.join(root, 'installed');
  const binDir = path.join(root, 'bin');
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

  const installed = spawnSync('bash', [path.resolve(__dirname, '..', 'install.sh')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      AGENTIC_SWE_ARCHIVE_URL: `file://${archive}`,
      AGENTIC_SWE_HOME: installDir,
      AGENTIC_SWE_BIN_DIR: binDir,
    },
  });
  assert.equal(installed.status, 0, installed.stderr);

  const executed = spawnSync(path.join(binDir, 'agentic-swe'), [], { encoding: 'utf8' });
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(executed.stdout.trim(), 'fixture tool');
});
