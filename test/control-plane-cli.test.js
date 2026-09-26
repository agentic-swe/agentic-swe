'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { inspect } = require('../scripts/doctor.cjs');

const bin = path.resolve(__dirname, '../bin/agentic-swe.cjs');

test('scan JSON reports a clean empty directory', (t) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'control-plane-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [bin, 'scan', '--target', target, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).summary.status, 'clean');
});

test('doctor reports Jev readiness without the key', (t) => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-jev-'));
  t.after(() => fs.rmSync(target, { recursive: true, force: true }));
  const ready = inspect({ target }, { env: { TYPESAFE_API_KEY: 'secret-value' } });
  assert.equal(ready.jev.state, 'ready');
  assert.equal(JSON.stringify(ready).includes('secret-value'), false);
  const missing = inspect({ target }, { env: {} });
  assert.equal(missing.jev.state, 'missing_key');
});
