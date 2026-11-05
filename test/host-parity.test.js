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

test('host parity reports policy_hook for every host', () => {
  const rows = reportHostParity();
  const registered = rows.filter((row) => row.policy_hook).map((row) => row.host);
  assert.deepEqual(registered, [
    'claude-code',
    'cursor',
    'codex',
    'opencode',
    'antigravity',
    'windsurf',
    'kiro',
    'copilot',
  ]);
  const vscode = rows.find((row) => row.host === 'vscode');
  assert.equal(vscode.policy_hook, false);
  assert.match(vscode.policy_hook_reason, /Verified 2026-11-05/);
  assert.match(vscode.policy_hook_reason, /Preview/);
  assert.match(vscode.policy_hook_reason, /code\.visualstudio\.com\/docs\/agent-customization\/hooks/);
  assert.ok(rows.every((row) => typeof row.policy_hook === 'boolean' && row.policy_hook_reason));
});
