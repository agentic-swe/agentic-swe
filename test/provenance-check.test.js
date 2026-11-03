'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  bodyShingleHashes,
  packHashes,
  unpackHashes,
  jaccard,
  bodyContentHash,
} = require('../scripts/lib/provenance/shingles.cjs');

const root = path.join(__dirname, '..');
const checkScript = path.join(root, 'scripts', 'provenance-check.cjs');

describe('provenance shingles', () => {
  it('round-trips packed hashes and scores identical bodies at 1', () => {
    const body = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa.';
    const hashes = bodyShingleHashes(body);
    assert.ok(hashes.length >= 1);
    const packed = packHashes(hashes);
    const set = unpackHashes(packed);
    assert.strictEqual(jaccard(hashes, set), 1);
    assert.strictEqual(bodyContentHash(body).length, 64);
  });

  it('scores unrelated bodies near zero', () => {
    const a = bodyShingleHashes('one two three four five six seven eight nine ten');
    const b = bodyShingleHashes('red blue green yellow purple orange violet indigo');
    assert.ok(jaccard(a, b) < 0.2);
  });
});

describe('provenance-check', () => {
  it('runs report-only successfully against the catalog', () => {
    const r = spawnSync(process.execPath, [checkScript, '--json'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
    const data = JSON.parse(r.stdout);
    assert.ok(data.summary.compared >= 100);
    assert.ok(data.summary.max_score >= 0.5, 'expected remaining copies to still match upstream');
    assert.strictEqual(data.summary.enforce, false);
  });

  it('enforce fails while unattributed copies remain', () => {
    const r = spawnSync(process.execPath, [checkScript, '--enforce'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    assert.ok(r.status !== 0, 'expected enforce to fail until rewrite complete');
    assert.match(r.stderr + r.stdout, /ENFORCE failed|over_threshold/i);
  });
});
