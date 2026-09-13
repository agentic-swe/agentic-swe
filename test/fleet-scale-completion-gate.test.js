'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { evaluateFleetScaleGate } = require('../scripts/lib/fleet/fleet-scale-gate.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('fleet scale completion gate', () => {
  it('evaluateFleetScaleGate met on pack with 3 independent archives', () => {
    const gate = evaluateFleetScaleGate(pluginRoot);
    assert.equal(gate.met, true);
    assert.equal(gate.status, 'met');
    assert.equal(gate.distinct_independent_consumers, 3);
  });

  it('evaluateFleetScaleGate met with 3 tmp independent archives', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-gate-'));
    const dir = path.join(tmp, 'bench', 'results', 'fleet-submissions');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 1; i <= 3; i++) {
      fs.writeFileSync(
        path.join(dir, `indep-${i}.json`),
        JSON.stringify({
          fleet_evidence_class: 'independent',
          project_root: path.join(tmp, `consumer-${i}`),
          fleet_submission_ready: true,
        })
      );
    }
    const gate = evaluateFleetScaleGate(tmp);
    assert.equal(gate.met, true);
    assert.equal(gate.status, 'met');
    assert.equal(gate.distinct_independent_consumers, 3);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('bench fixture proves gate mechanics in isolation', () => {
    const out = path.join(os.tmpdir(), `fleet-scale-gate-fixture-${Date.now()}.json`);
    const r = spawnSync(process.execPath, ['scripts/bench/run-fleet-scale-gate-fixture.cjs', '--out', out], {
      cwd: pluginRoot,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const payload = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(payload.fleet_scale_gate.met, true);
    assert.equal(payload.goal_complete_derivation, true);
    fs.rmSync(out, { force: true });
  });
});
