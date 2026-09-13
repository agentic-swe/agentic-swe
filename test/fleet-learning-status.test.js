'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const pluginRoot = path.resolve(__dirname, '..');

describe('fleet-learning-status', () => {
  it('reports pack fleet-learning status aligned with objective-evidence', () => {
    const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts/fleet-learning-status.cjs'), '--json'], {
      encoding: 'utf8',
      cwd: pluginRoot,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const p = JSON.parse(r.stdout);
    assert.equal(p.goal_complete, p.pack_scorecard_all_met === true);
    assert.ok(Array.isArray(p.blockers));
    assert.match(p.measurement_contract, /fleet/i);
    assert.ok(p.procedures && typeof p.procedures.evaluated === 'number');
    assert.equal(p.submission_readiness?.fleet_submission_ready, false);
    assert.equal(p.pack_scorecard_local_met, true);
    assert.equal(p.pack_scorecard_all_met, true);
    assert.ok(p.fleet_submissions_independent?.distinct_independent_consumers >= 3);
    assert.ok((p.fleet_submissions?.archived || 0) >= 3);
    assert.ok(p.fleet_archive_detail);
    assert.ok(p.fleet_archive_detail.entries.length >= 3);
    assert.equal(p.fleet_archive_detail.fleet_scale_met, true);
    assert.equal(p.blockers.length, 0);
  });
});
