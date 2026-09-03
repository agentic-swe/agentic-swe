'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const pluginRoot = path.resolve(__dirname, '..');

describe('objective-evidence scorecard', () => {
  it('reports scorecard_all_met true when fleet-scale is complete', () => {
    const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts/objective-evidence.cjs')], {
      encoding: 'utf8',
      cwd: pluginRoot,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const out = path.join(pluginRoot, 'bench', 'results');
    const files = require('node:fs')
      .readdirSync(out)
      .filter((f) => f.startsWith('objective-evidence-') && f.endsWith('.json'))
      .sort();
    const payload = JSON.parse(require('node:fs').readFileSync(path.join(out, files[files.length - 1]), 'utf8'));
    assert.equal(payload.goal_complete, payload.scorecard_all_met);
    assert.equal(payload.scorecard_local_met, true);
    assert.equal(payload.scorecard_all_met, true);
    assert.equal(payload.goal_complete, true);
    const fleet = payload.requirements.find((row) => row.id === 'fleet-scale-independent');
    assert.ok(fleet);
    assert.equal(fleet.status, 'met');
    const dogfood = payload.requirements.find((row) => row.id === 'maintainer-dogfood-pipeline');
    assert.ok(dogfood);
    assert.equal(dogfood.status, 'met');
    assert.ok(payload.fleet_scale_progress);
    assert.equal(payload.fleet_scale_progress.target, 3);
    assert.ok(payload.fleet_scale_progress.maintainer_dogfood_consumers.length >= 3);
    assert.ok(payload.fleet_archive_detail);
    assert.equal(payload.fleet_archive_detail.fleet_scale_met, true);
    assert.equal(payload.fleet_submissions.fleet_scale.distinct_independent_consumers, 3);
    assert.ok(payload.fleet_archive_detail.maintainer_dogfood_count >= 3);
    assert.match(payload.honesty, /independent fleet submissions/);
  });
});
