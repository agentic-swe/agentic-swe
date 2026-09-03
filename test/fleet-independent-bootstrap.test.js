'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runFleetIndependentBootstrap } = require('../scripts/fleet-independent-bootstrap.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('fleet-independent-bootstrap', () => {
  it('bootstraps tmp consumer without maintainer_dogfood class', async () => {
    const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-indep-'));
    const r = await runFleetIndependentBootstrap({
      consumerRoot: consumer,
      pluginRoot,
      skipSessions: true,
    });
    assert.equal(r.fleet_evidence_class, 'independent');
    assert.equal(r.goal_complete, false);
    assert.ok(fs.existsSync(path.join(consumer, '.agentic-swe', 'fleet-status.json')));
    fs.rmSync(consumer, { recursive: true, force: true });
  });

  it('blocks known maintainer_dogfood consumer root', async () => {
    const dogfoodRoot = '/Users/surajg/hobby-projects/salesforce-agentic-swe';
    if (!fs.existsSync(dogfoodRoot)) return;
    const r = await runFleetIndependentBootstrap({
      consumerRoot: dogfoodRoot,
      pluginRoot,
      skipSessions: true,
    });
    assert.ok(r.blockers.some((b) => b.includes('maintainer_dogfood')));
  });
});
