'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const pluginRoot = path.resolve(__dirname, '..');

describe('objective-evidence scorecard', () => {
  it('committed snapshot reports scorecard_all_met from archived fleet evidence', () => {
    const committed = path.join(pluginRoot, 'bench', 'results', 'objective-evidence-2026-09-13.json');
    const payload = JSON.parse(fs.readFileSync(committed, 'utf8'));
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
    assert.equal(payload.fleet_archive_detail.fleet_scale_met, true);
    assert.equal(payload.fleet_submissions.fleet_scale.distinct_independent_consumers, 3);
    assert.ok(payload.fleet_archive_detail.maintainer_dogfood_count >= 3);
    assert.match(payload.honesty, /independent fleet submissions/);
  });

  it('fresh run keeps fleet-scale met from committed archives without writing pack results', () => {
    const out = path.join(os.tmpdir(), `objective-evidence-ci-${Date.now()}.json`);
    const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts/objective-evidence.cjs'), '--out', out], {
      encoding: 'utf8',
      cwd: pluginRoot,
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const payload = JSON.parse(fs.readFileSync(out, 'utf8'));
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
    fs.rmSync(out, { force: true });
  });
});
