'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  buildFleetStatusSnapshot,
  writeFleetStatusSnapshot,
  readFleetStatusSnapshot,
} = require('../scripts/lib/fleet/fleet-status-snapshot.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('fleet status snapshot', () => {
  it('skips pack root', () => {
    const r = buildFleetStatusSnapshot({ projectRoot: pluginRoot, pluginRoot });
    assert.equal(r.skipped, true);
  });

  it('writes and reads consumer fleet-status.json', () => {
    const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-status-'));
    const r = writeFleetStatusSnapshot({
      projectRoot: consumer,
      pluginRoot,
      muscleMemoryOk: true,
      source: 'test',
    });
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(r.path));

    const snap = readFleetStatusSnapshot(consumer);
    assert.equal(snap.consumer_mode, true);
    assert.equal(snap.goal_complete, false);
    assert.equal(snap.fleet_evidence_class, 'independent');
    assert.ok(Array.isArray(snap.next_steps));

    fs.rmSync(consumer, { recursive: true, force: true });
  });
});
