'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Compare two bench scorecard JSON files. Exit non-zero on regression.
 * @param {string} baselinePath
 * @param {string} currentPath
 * @param {object} [opts]
 * @returns {{ ok: boolean, regressions: object[] }}
 */
function compareScorecards(baselinePath, currentPath, opts = {}) {
  const minPassRate = opts.minPassRate ?? null;
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const current = JSON.parse(fs.readFileSync(currentPath, 'utf8'));

  const regressions = [];
  const baseMap = new Map((baseline.tasks || []).map((t) => [t.id, t]));
  const curMap = new Map((current.tasks || []).map((t) => [t.id, t]));

  for (const [id, base] of baseMap) {
    const cur = curMap.get(id);
    if (!cur) {
      regressions.push({ id, kind: 'missing_task', message: 'task absent in current scorecard' });
      continue;
    }
    const baseDelivered = base.delivered === true;
    const curDelivered = cur.delivered === true;
    if (baseDelivered && !curDelivered) {
      regressions.push({
        id,
        kind: 'delivery_regression',
        message: 'was delivered, now failed',
      });
    }
    const baseTotal = base.scores?.total ?? 0;
    const curTotal = cur.scores?.total ?? 0;
    if (curTotal + 0.05 < baseTotal) {
      regressions.push({
        id,
        kind: 'score_regression',
        message: `score ${curTotal.toFixed(3)} < baseline ${baseTotal.toFixed(3)}`,
      });
    }
  }

  if (minPassRate != null && current.summary?.pass_rate < minPassRate) {
    regressions.push({
      id: '_summary',
      kind: 'pass_rate',
      message: `pass_rate ${current.summary.pass_rate} < min ${minPassRate}`,
    });
  }

  if (baseline.summary?.pass_rate != null && current.summary?.pass_rate != null) {
    if (current.summary.pass_rate + 0.01 < baseline.summary.pass_rate) {
      regressions.push({
        id: '_summary',
        kind: 'pass_rate_regression',
        message: `pass_rate dropped from ${baseline.summary.pass_rate} to ${current.summary.pass_rate}`,
      });
    }
  }

  return { ok: regressions.length === 0, regressions, baseline, current };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const baselineIdx = args.indexOf('--baseline');
  const currentIdx = args.indexOf('--current');
  if (baselineIdx === -1 || currentIdx === -1) {
    console.error('Usage: node compare.cjs --baseline <file> --current <file>');
    process.exit(1);
  }
  const result = compareScorecards(args[baselineIdx + 1], args[currentIdx + 1]);
  if (result.ok) {
    console.log('No regressions detected.');
    process.exit(0);
  }
  console.error('Regressions:');
  for (const r of result.regressions) {
    console.error(`  [${r.id}] ${r.kind}: ${r.message}`);
  }
  process.exit(1);
}

module.exports = { compareScorecards };
