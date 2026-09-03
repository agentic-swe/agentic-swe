'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { tryDescentLadder, loadTierTokenEstimates } = require('../scripts/lib/descent/ladder.cjs');
const { promoteOrDemote } = require('../scripts/lib/descent/promotion.cjs');
const { buildFingerprint } = require('../scripts/lib/descent/fingerprint.cjs');

describe('descent ladder', () => {
  const tmp = path.join(__dirname, '_tmp-ladder');
  const pluginRoot = path.join(__dirname, '..');

  it('L0 hit costs zero delivered tokens', async () => {
    fs.mkdirSync(tmp, { recursive: true });
    const fp = buildFingerprint({ files: ['x.js'], verifyCommand: 'node -e "process.exit(0)"' });
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: fp,
      procedure: {
        verify: [{ type: 'RUN', command: 'node -e "process.exit(0)"' }],
      },
      evalPassed: true,
      humanApproved: true,
    });
    const r = await tryDescentLadder({
      projectRoot: tmp,
      pluginRoot,
      verifyCommand: 'node -e "process.exit(0)"',
      files: ['x.js'],
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.tier, 'L0');
    assert.strictEqual(r.delivered_tokens, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('L1 verify match costs L1 token estimate', async () => {
    fs.mkdirSync(tmp, { recursive: true });
    const fp = buildFingerprint({ files: ['y.js'], verifyCommand: 'node -e "process.exit(0)"' });
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: fp,
      procedure: {
        verify: [{ type: 'RUN', command: 'node -e "process.exit(0)"' }],
      },
      evalPassed: true,
      humanApproved: false,
    });
    const store = JSON.parse(fs.readFileSync(path.join(tmp, '.agentic-swe/procedures.json'), 'utf8'));
    store.procedures[0].tier = 'L1';
    fs.writeFileSync(path.join(tmp, '.agentic-swe/procedures.json'), JSON.stringify(store, null, 2));

    const est = loadTierTokenEstimates(pluginRoot);
    const r = await tryDescentLadder({
      projectRoot: tmp,
      pluginRoot,
      verifyCommand: 'node -e "process.exit(0)"',
      files: ['other.js'],
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.tier, 'L1');
    assert.strictEqual(r.delivered_tokens, est.L1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('portfolio bench requires holdout coverage for target_met', async () => {
    const { spawnSync } = require('node:child_process');
    const accum = spawnSync(process.execPath, [
      path.join(pluginRoot, 'scripts/bench/accumulate-holdout-procedures.cjs'),
    ], { encoding: 'utf8', cwd: pluginRoot });
    assert.strictEqual(accum.status, 0, accum.stderr + accum.stdout);

    const out = path.join(__dirname, '_tmp-portfolio-honesty.json');
    const r = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts/bench/run-portfolio.cjs'), '--out', out],
      { encoding: 'utf8', cwd: pluginRoot }
    );
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const payload = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(payload.holdout.summary.delivered >= 3, 'need 3+ delivered holdout tasks');
    assert.strictEqual(payload.combined.bench_target_met, true);
    if (payload.combined.production_verified) {
      assert.ok(['proven_at_scale', 'proven_e2e_bench'].includes(payload.combined.claim_status));
    } else {
      assert.strictEqual(payload.combined.claim_status, 'not_proven_at_scale');
    }
    if ((payload.combined.live_work_items ?? 0) >= 1) {
      assert.strictEqual(payload.combined.claim_status, 'proven_at_scale');
      assert.strictEqual(payload.combined.target_met, true);
    } else {
      assert.strictEqual(payload.combined.claim_status, 'proven_e2e_bench');
      assert.strictEqual(payload.combined.target_met, false);
    }
    fs.unlinkSync(out);
  });
});
