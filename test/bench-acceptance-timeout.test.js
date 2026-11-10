'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { runAcceptanceCommand } = require('../scripts/lib/bench/score-dimension.cjs');
const { runTaskAcceptance } = require('../scripts/lib/bench/run-task.cjs');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const MINED_CHECK = path.join(PLUGIN_ROOT, 'bench', 'corpus', 'mined-check-pass');

test('spawnSync node -e console.log(1) returns immediately', () => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['-e', 'console.log(1)'], {
    encoding: 'utf8',
    timeout: 5000,
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.ok(Date.now() - t0 < 5000, `spawn took ${Date.now() - t0}ms`);
  assert.equal(r.status, 0, r.stderr || r.error);
  assert.equal(String(r.stdout || '').trim(), '1');
});

test('runAcceptanceCommand times out instead of hanging forever', () => {
  const taskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-accept-timeout-'));
  // Avoid argv SHELL_META rejects (`=>` has `>`, `for(;;)` has `;`).
  const hang = [process.execPath, '-e', 'while (true) {}'];
  const t0 = Date.now();
  const result = runAcceptanceCommand(taskDir, {
    method: 'run_command',
    command: hang,
    timeout_ms: 400,
  });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 5000, `expected timeout within 5s, took ${elapsed}ms`);
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, 124);
  assert.match(result.stderr, /timed out after 400ms/);
  fs.rmSync(taskDir, { recursive: true, force: true });
});

test('mined-check-pass acceptance completes within a bound', () => {
  const t0 = Date.now();
  const run = runTaskAcceptance(MINED_CHECK);
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 15_000, `acceptance hung: ${elapsed}ms`);
  assert.equal(run.ok, true, run.stderr || `exit ${run.exitCode}`);
});
