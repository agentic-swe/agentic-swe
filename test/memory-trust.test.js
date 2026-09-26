'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { annotateTrust, canReplay, decayConfidence, isJevEvidence, promoteTrust } = require('../scripts/lib/memory/trust.cjs');

test('external memory cannot replay before promotion', () => {
  const record = annotateTrust({ id: 'memory-1', external: true }, '2026-09-26T00:00:00Z');
  assert.equal(canReplay(record), false);
  assert.equal(canReplay(promoteTrust(record, { confirmations: 2, humanApproved: false })), true);
  assert.equal(canReplay(promoteTrust(record, { confirmations: 0, humanApproved: true })), true);
});

test('confidence decays by one tenth per window', () => {
  const record = annotateTrust({ id: 'memory-2', confidence: 0.9 }, '2026-09-26T00:00:00Z');
  const decayed = decayConfidence(record, '2026-09-28T00:00:00Z', 24 * 60 * 60 * 1000);
  assert.equal(decayed.confidence, 0.7);
});

test('Jev advisory evidence cannot become a procedure', () => {
  const record = { actor: 'jev', kind: 'pipeline.jev_track' };
  assert.equal(isJevEvidence(record), true);
  assert.throws(() => promoteTrust(record, { confirmations: 2, humanApproved: true }), /jev evidence cannot be promoted/);
});
