'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  extractSignedOffEmails,
  isMergeCommit,
  checkCommitDco,
  checkCommitsDco,
  formatDcoResult,
} = require('../scripts/lib/skills/dco-check.cjs');

const root = path.resolve(__dirname, '..');
const msgDir = path.join(root, 'test', 'fixtures', 'skill-external-contribution', 'dco-messages');

function loadMsg(name) {
  return fs.readFileSync(path.join(msgDir, name), 'utf8');
}

describe('AE-028b DCO check (pure commit metadata)', () => {
  it('extracts Signed-off-by emails and matches author case-insensitively', () => {
    const emails = extractSignedOffEmails(loadMsg('signed-ok.txt'));
    assert.deepEqual(emails, ['alice@example.com']);

    const ok = checkCommitDco({
      hash: 'abc123',
      authorEmail: 'alice@example.com',
      message: loadMsg('signed-ok.txt'),
      parentCount: 1,
    });
    assert.equal(ok.ok, true);

    const folded = checkCommitDco({
      hash: 'def456',
      authorEmail: 'alice@example.com',
      message: loadMsg('signed-case-insensitive.txt'),
      parents: ['parent1'],
    });
    assert.equal(folded.ok, true);
  });

  it('fails closed on missing trailer, blank author, and email mismatch', () => {
    const missing = checkCommitDco({
      hash: '1',
      authorEmail: 'alice@example.com',
      message: loadMsg('unsigned.txt'),
      parentCount: 1,
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'DCO_MISSING');

    const blank = checkCommitDco({
      hash: '2',
      authorEmail: '   ',
      message: loadMsg('signed-ok.txt'),
      parentCount: 1,
    });
    assert.equal(blank.ok, false);
    assert.equal(blank.code, 'AUTHOR_EMAIL_BLANK');

    const mismatch = checkCommitDco({
      hash: '3',
      authorEmail: 'alice@example.com',
      message: loadMsg('email-mismatch.txt'),
      parentCount: 1,
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'DCO_EMAIL_MISMATCH');
  });

  it('skips merge commits (2+ parents) and aggregates range results', () => {
    assert.equal(isMergeCommit({ parentCount: 2 }), true);
    assert.equal(isMergeCommit({ parents: ['a', 'b'] }), true);
    assert.equal(isMergeCommit({ parents: 'a b' }), true);
    assert.equal(isMergeCommit({ parentCount: 1 }), false);

    const merge = checkCommitDco({
      hash: 'merge1',
      authorEmail: 'alice@example.com',
      message: loadMsg('unsigned.txt'),
      parentCount: 2,
    });
    assert.equal(merge.ok, true);
    assert.equal(merge.skipped, true);

    const outcome = checkCommitsDco([
      {
        hash: 'm',
        authorEmail: 'alice@example.com',
        message: loadMsg('unsigned.txt'),
        parentCount: 2,
      },
      {
        hash: 'good',
        authorEmail: 'alice@example.com',
        message: loadMsg('signed-ok.txt'),
        parentCount: 1,
      },
      {
        hash: 'bad',
        authorEmail: 'alice@example.com',
        message: loadMsg('unsigned.txt'),
        parentCount: 1,
      },
    ]);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.checked, 2);
    assert.equal(outcome.skipped, 1);
    assert.equal(outcome.failures.length, 1);
    assert.equal(outcome.failures[0].hash, 'bad');
    assert.match(formatDcoResult(outcome), /dco-check: FAIL/);
  });

  it('null/undefined commit fields fail closed (no silent skip)', () => {
    const noEmail = checkCommitDco({
      hash: 'x',
      authorEmail: null,
      message: loadMsg('signed-ok.txt'),
      parentCount: 1,
    });
    assert.equal(noEmail.ok, false);
    assert.equal(noEmail.code, 'AUTHOR_EMAIL_BLANK');

    const emptyMsg = checkCommitDco({
      hash: 'y',
      authorEmail: 'alice@example.com',
      message: '',
      parentCount: 1,
    });
    assert.equal(emptyMsg.ok, false);
    assert.equal(emptyMsg.code, 'DCO_MISSING');
  });
});
