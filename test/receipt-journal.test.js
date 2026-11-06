'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { commitState, appendEvent } = require('../scripts/lib/shared/journal.cjs');
const { extractReceipt } = require('../scripts/lib/receipt/extract.cjs');
const { verifyReceipt } = require('../scripts/lib/receipt/verify.cjs');

function worklog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-journal-'));
  const state = {
    work_id: 'journal-work',
    task: 'journal task',
    current_state: 'initialized',
    created_at: '2026-11-06T00:00:00.000Z',
    updated_at: '2026-11-06T00:00:00.000Z',
    history: [],
    pipeline: { track: 'rigorous' },
    budget: { cost_used: 0, budget_remaining: 1 },
  };
  commitState(dir, state, { type: 'init', at: state.created_at });
  state.current_state = 'implementation';
  state.updated_at = '2026-11-06T00:01:00.000Z';
  state.history = [{
    at: state.updated_at, from: 'initialized', to: 'implementation',
    actor: 'agent', reason: 'token is ghp_12345678901234567890',
  }];
  const projected = commitState(dir, state, { type: 'transition', at: state.updated_at });
  fs.writeFileSync(path.join(dir, 'state.json'), `${JSON.stringify(projected, null, 2)}\n`);
  appendEvent(dir, {
    type: 'policy.decided',
    payload: {
      decision: 'allow', rule_id: 'tool.read', policy_digest: 'a'.repeat(64),
      tool_name: 'test', input_summary: 'token=ghp_12345678901234567890',
    },
    idempotency_key: 'policy:1',
  });
  appendEvent(dir, {
    type: 'tool.requested',
    payload: { tool_id: 'test', policy_decision_ref: { seq: 3 } },
    idempotency_key: 'requested:1',
  });
  appendEvent(dir, {
    type: 'test.side',
    payload: { note: 'test passed' },
    idempotency_key: 'test:1',
  });
  fs.writeFileSync(path.join(dir, 'implementation.md'), 'secret=ghp_12345678901234567890\n');
  return dir;
}

test('journal-derived receipts carry source_seq and redact secrets', () => {
  const dir = worklog();
  const receipt = extractReceipt(dir);
  assert.equal(receipt.integrity, 'verified');
  assert.ok(receipt.decisions.every((entry) => Number.isInteger(entry.source_seq)));
  assert.ok(receipt.policyDecisions.every((entry) => Number.isInteger(entry.source_seq)));
  assert.ok(receipt.artifacts[0].sha256);
  assert.doesNotMatch(JSON.stringify(receipt), /ghp_12345678901234567890/);
});

test('state history edits do not change a journal-derived receipt', () => {
  const dir = worklog();
  const before = extractReceipt(dir);
  const statePath = path.join(dir, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.history[0].reason = 'rewritten history';
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const after = extractReceipt(dir);
  assert.deepEqual(after.decisions, before.decisions);
});

test('receipt verifier fails closed on journal tamper without network', () => {
  const dir = worklog();
  const journal = path.join(dir, 'journal.jsonl');
  const lines = fs.readFileSync(journal, 'utf8').trimEnd().split('\n');
  lines[1] = lines[1].replace('implementation', 'tampered');
  fs.writeFileSync(journal, `${lines.join('\n')}\n`);
  const result = verifyReceipt(dir);
  assert.equal(result.ok, false);
  assert.match(result.integrity, /^FAILED at seq 2$/);
  assert.equal(extractReceipt(dir).integrity, 'FAILED at seq 2');
});
