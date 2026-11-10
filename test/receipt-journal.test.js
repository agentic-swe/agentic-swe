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

test('F-M2-05: costUsd folds usage.recorded only (not state.budget.cost_used)', () => {
  const dir = worklog();
  const statePath = path.join(dir, 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.budget = { cost_used: 99.99, budget_remaining: 0 };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  appendEvent(dir, {
    type: 'usage.recorded',
    payload: {
      provider: 'local', model: 'fixture', usd: 1.25, cost_source: 'local',
      usage_source: 'absent', status: 'ok', finish_reason: 'stop', latency_ms: 1,
    },
    idempotency_key: 'usage:1',
  });
  appendEvent(dir, {
    type: 'usage.recorded',
    payload: {
      provider: 'local', model: 'fixture', usd: 0.75, cost_source: 'local',
      usage_source: 'absent', status: 'ok', finish_reason: 'stop', latency_ms: 1,
    },
    idempotency_key: 'usage:2',
  });
  const receipt = extractReceipt(dir);
  assert.equal(receipt.costUsd, 2.0);
  assert.equal(receipt.trust, 'cooperative');
  assert.match(receipt.trustDisclaimer || '', /cooperative evidence/);
  assert.ok(receipt.divergences.some((d) => d.field === 'costUsd'));
  assert.deepEqual(receipt.counters, {});
});

test('F-M2-05: integrity vocabulary is no-journal / unverified-import (not unanchored)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-nojournal-'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    work_id: 'no-j', task: 't', current_state: 'completed', history: [],
    pipeline: { track: 'lean' }, budget: { cost_used: 1.5 },
  }, null, 2));
  const receipt = extractReceipt(dir);
  assert.equal(receipt.integrity, 'no-journal');
  assert.notEqual(receipt.integrity, 'unanchored');
  const verified = verifyReceipt(dir);
  assert.equal(verified.integrity, 'no-journal');
});

test('F-M2-05: receipt verify reports ARTIFACT_MISMATCH when digests diverge', () => {
  const dir = worklog();
  const receipt = extractReceipt(dir);
  fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  assert.equal(verifyReceipt(dir).ok, true);
  fs.writeFileSync(path.join(dir, 'implementation.md'), 'tampered-after-receipt\n');
  const result = verifyReceipt(dir);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ARTIFACT_MISMATCH');
});

test('F-M2-05: re-rendering receipt.json does not fail its own artifact check', () => {
  const dir = worklog();
  fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(extractReceipt(dir), null, 2));
  const second = extractReceipt(dir);
  assert.ok(!second.artifacts.some((a) => a.path === 'receipt.json'));
  fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(second, null, 2));
  assert.equal(verifyReceipt(dir).ok, true);
});

test('F-M2-05: stripped digest or escaping path in receipt.json fails, never skips', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside\n');
  const cases = [
    (r) => { r.artifacts[0].sha256 = undefined; },
    (r) => { r.artifacts.push({ path: path.relative(dir0, path.join(outside, 'secret.txt')), sha256: 'a'.repeat(64) }); },
    (r) => { r.artifacts.push({ path: path.join(outside, 'secret.txt'), sha256: 'a'.repeat(64) }); },
    (r) => { r.artifacts = 'nope'; },
  ];
  let dir0;
  for (const mutate of cases) {
    dir0 = worklog();
    const receipt = extractReceipt(dir0);
    assert.ok(receipt.artifacts.length > 0);
    mutate(receipt);
    fs.writeFileSync(path.join(dir0, 'receipt.json'), JSON.stringify(receipt, null, 2));
    const result = verifyReceipt(dir0);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'RECEIPT_INVALID');
  }
  // Symlink inside the work dir pointing outside it.
  const dir = worklog();
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(dir, 'link.md'));
  const receipt = extractReceipt(dir);
  fs.writeFileSync(path.join(dir, 'receipt.json'), JSON.stringify(receipt, null, 2));
  const result = verifyReceipt(dir);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'RECEIPT_INVALID');
  fs.rmSync(outside, { recursive: true, force: true });
});
