'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { commitState, readJournal } = require('../scripts/lib/shared/journal.cjs');
const { anchorHeadHash, anchorAndJournal, localAnchorReport } = require('../scripts/lib/github/anchor.cjs');
const { extractReceipt } = require('../scripts/lib/receipt/extract.cjs');
const { verifyReceipt } = require('../scripts/lib/receipt/verify.cjs');
const { assertGitHubVerification } = require('../scripts/lib/github/verification.cjs');

const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function workDir(track = 'standard') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-023b-anchor-'));
  const state = {
    work_id: 'anchor-work',
    current_state: 'approval-wait',
    pipeline: { track },
    history: [],
    approvals: {},
    journal: { seq: 0 },
  };
  const snapshot = commitState(dir, state, { type: 'init', updated_at: '2026-11-06T00:00:00Z' });
  fs.writeFileSync(path.join(dir, 'state.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(path.join(dir, 'pr-link.txt'), 'https://github.com/acme/widgets/pull/42\n');
  return dir;
}

function fakeConnector({ write = true } = {}) {
  const calls = [];
  const runs = [];
  return {
    writeEnabled: write,
    calls,
    async listCheckRuns(repo, sha) {
      calls.push(['GET', repo, sha]);
      return { ok: true, data: runs.filter((run) => run.head_sha === sha) };
    },
    async createCheckRun(repo, body) {
      calls.push(['POST', repo, body]);
      if (!write) return { ok: false, code: 'DENIED_UNAUTHORIZED', message: 'writes disabled' };
      runs.push({ id: runs.length + 1, app: { slug: 'agentic-swe' }, ...body });
      return { ok: true, status: 201, data: runs.at(-1) };
    },
  };
}

test('write-enabled anchor is idempotent and verified by a read-only GET', async () => {
  const connector = fakeConnector();
  const first = await anchorHeadHash({
    connector, repo: 'acme/widgets', headSha: HEAD, workId: 'anchor-work', seq: 1,
    hash: 'a'.repeat(64), config: { anchor: { check_name: 'agentic-swe journal anchor', app_slug: 'agentic-swe' } },
  });
  const second = await anchorHeadHash({
    connector, repo: 'acme/widgets', headSha: HEAD, workId: 'anchor-work', seq: 1,
    hash: 'a'.repeat(64), config: { anchor: { check_name: 'agentic-swe journal anchor', app_slug: 'agentic-swe' } },
  });
  assert.equal(first.status, 'anchored');
  assert.equal(second.status, 'anchored');
  assert.equal(connector.calls.filter((call) => call[0] === 'POST').length, 1);
  assert.equal(connector.calls.filter((call) => call[0] === 'GET').length, 4);
});

test('without write authorization no check-run write is attempted', async () => {
  const connector = fakeConnector({ write: false });
  const result = await anchorHeadHash({
    connector, repo: 'acme/widgets', headSha: HEAD, workId: 'anchor-work', seq: 1,
    hash: 'b'.repeat(64), config: {},
  });
  assert.equal(result.status, 'unanchored');
  assert.equal(connector.calls.filter((call) => call[0] === 'POST').length, 0);
});

test('a rewritten self-consistent journal is detected as ANCHOR_MISMATCH', async () => {
  const dir = workDir();
  const connector = fakeConnector();
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const result = await anchorAndJournal({
    workDir: dir, state, connector, link: { repo: 'acme/widgets', pr: 42 }, headSha: HEAD, config: {},
  });
  assert.equal(result.status, 'anchored');
  const lines = fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8').trimEnd().split('\n');
  const first = JSON.parse(lines[0]);
  first.state.task = 'rewritten';
  first.hash = require('../scripts/lib/shared/journal.cjs').eventHash(first);
  lines[0] = JSON.stringify(first);
  for (let i = 1; i < lines.length; i++) {
    const event = JSON.parse(lines[i]);
    event.prev_hash = JSON.parse(lines[i - 1]).hash;
    event.hash = require('../scripts/lib/shared/journal.cjs').eventHash(event);
    lines[i] = JSON.stringify(event);
  }
  fs.writeFileSync(path.join(dir, 'journal.jsonl'), `${lines.join('\n')}\n`);
  const receipt = extractReceipt(dir);
  assert.equal(receipt.anchor, 'ANCHOR_MISMATCH');
  assert.equal(verifyReceipt(dir).code, 'ANCHOR_MISMATCH');
});

test('lean and standard remain optional while rigorous requires the anchor', () => {
  for (const track of ['lean', 'standard']) {
    const dir = workDir(track);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json')));
    state.approvals = { github_verification: {
      verdict: 'approved', repo: 'acme/widgets', pr: 42, approval_iter: 0, history_length: 0,
    } };
    const snapshot = commitState(dir, state, { type: 'github.verified' });
    fs.writeFileSync(path.join(dir, 'state.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    assert.equal(assertGitHubVerification({ workDir: dir, state }).ok, true);
  }
  const rigorous = workDir('rigorous');
  const state = JSON.parse(fs.readFileSync(path.join(rigorous, 'state.json')));
  state.approvals = { github_verification: {
    verdict: 'approved', repo: 'acme/widgets', pr: 42, approval_iter: 0, history_length: 0,
  } };
  const snapshot = commitState(rigorous, state, { type: 'github.verified' });
  fs.writeFileSync(path.join(rigorous, 'state.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  assert.equal(assertGitHubVerification({ workDir: rigorous, state }).code, 'GITHUB_APPROVAL_REQUIRED');
});
