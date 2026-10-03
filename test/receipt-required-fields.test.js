'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { extractReceipt } = require('../scripts/lib/receipt/extract.cjs');

const FIXTURE = path.join(__dirname, 'fixtures/receipt/lean-happy');

const REQUIRED = [
  'workId',
  'task',
  'track',
  'status',
  'costUsd',
  'decisions',
  'humanGates',
  'prUrl',
  'auditEntryCount',
];

describe('receipt required fields (CI lock)', () => {
  it('golden lean fixture exposes all receipt contract fields', () => {
    const r = extractReceipt(FIXTURE);
    for (const key of REQUIRED) {
      assert.notEqual(r[key], undefined, `missing ${key}`);
      assert.notEqual(r[key], null, `null ${key}`);
    }
    assert.ok(Array.isArray(r.decisions) && r.decisions.length > 0);
    assert.ok(Array.isArray(r.humanGates) && r.humanGates.length > 0);
    assert.equal(typeof r.costUsd, 'number');
    assert.match(String(r.prUrl), /^https?:\/\//);
  });
});
