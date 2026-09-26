'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { SUPPORTED_HOSTS } = require('../scripts/setup.cjs');
const { reportHostParity } = require('../scripts/lib/host-parity/report.cjs');

test('every setup host has one parity status', () => {
  const rows = reportHostParity();
  assert.deepEqual(rows.map((row) => row.host), SUPPORTED_HOSTS);
  assert.equal(rows.find((row) => row.host === 'claude-code').status, 'stable');
  assert.equal(rows.find((row) => row.host === 'cursor').status, 'partial');
  assert.equal(rows.find((row) => row.host === 'antigravity').status, 'instruction-only');
});
