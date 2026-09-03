'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { recordDescentTierUsage } = require('../scripts/lib/descent/record-descent-tier.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('record-descent-tier', () => {
  it('records L0 tier into work item state', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-tier-'));
    const workDir = path.join(tmp, 'w1');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({ work_id: 'w1', budget: {} }, null, 2),
      'utf8'
    );

    const r = recordDescentTierUsage({
      workDir,
      pluginRoot,
      tier: 'L0',
      hit: true,
      source: 'test',
    });
    assert.equal(r.ok, true);
    assert.equal(r.tier, 'L0');
    assert.equal(r.input_tokens, 0);

    const state = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
    assert.equal(state.metrics.descent_tier, 'L0');
    assert.ok(state.budget.tier_totals.L0);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('production-evidence bench', () => {
  it('runs E2E and verifies production multiplier', () => {
    const { spawnSync } = require('node:child_process');
    const out = path.join(__dirname, '_tmp-prod-evidence.json');
    const r = spawnSync(
      process.execPath,
      [
        path.join(pluginRoot, 'scripts/bench/run-production-evidence.cjs'),
        '--out',
        out,
      ],
      { encoding: 'utf8', cwd: pluginRoot, timeout: 120000 }
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const payload = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(payload.verified, true);
    assert.ok(payload.runs.length >= 3);
    assert.ok(payload.portfolio.portfolio_multiplier <= 0.02);

    fs.unlinkSync(out);
  });
});
