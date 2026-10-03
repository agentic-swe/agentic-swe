'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readRecentReceipts } = require('./hook-receipt.cjs');

/**
 * Sum redaction_hits recorded on recent hook receipts (top-level or steps.*).
 * @param {string} projectRoot
 * @param {number} [limit]
 * @returns {{ total: number, receipts_with_hits: number, sample: number[] }}
 */
function summarizeRedactionHits(projectRoot, limit = 50) {
  const receipts = readRecentReceipts(projectRoot, limit);
  let total = 0;
  let receiptsWithHits = 0;
  const sample = [];
  for (const receipt of receipts) {
    let hits = 0;
    if (typeof receipt.redaction_hits === 'number') hits += receipt.redaction_hits;
    const steps = receipt.steps && typeof receipt.steps === 'object' ? receipt.steps : {};
    for (const value of Object.values(steps)) {
      if (value && typeof value === 'object' && typeof value.redaction_hits === 'number') {
        hits += value.redaction_hits;
      }
      if (value && typeof value === 'object' && typeof value.redactionHits === 'number') {
        hits += value.redactionHits;
      }
    }
    if (hits > 0) {
      receiptsWithHits += 1;
      sample.push(hits);
    }
    total += hits;
  }
  return { total, receipts_with_hits: receiptsWithHits, sample: sample.slice(-5) };
}

module.exports = { summarizeRedactionHits };
