'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { SUPPORTED_HOSTS } = require('../scripts/setup.cjs');
const { reportHostParity } = require('../scripts/lib/host-parity/report.cjs');

test('every setup host has one parity status', () => {
  const rows = reportHostParity();
  assert.deepEqual(rows.map((row) => row.host), SUPPORTED_HOSTS);
  assert.equal(rows.find((row) => row.host === 'claude-code').status, 'stable');
  assert.equal(rows.find((row) => row.host === 'cursor').status, 'stable');
  assert.equal(rows.find((row) => row.host === 'opencode').status, 'stable');
  assert.equal(rows.find((row) => row.host === 'vscode').status, 'partial');
  assert.equal(rows.find((row) => row.host === 'codex').status, 'stable');
  assert.equal(rows.find((row) => row.host === 'antigravity').status, 'stable');
  assert.equal(rows.find((row) => row.host === 'windsurf').status, 'stable');
  assert.equal(rows.find((row) => row.host === 'kiro').status, 'stable');
  assert.equal(rows.find((row) => row.host === 'copilot').status, 'partial');
  assert.ok(rows.every((row) => row.reason));
});
