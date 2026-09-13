'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const pluginRoot = path.resolve(__dirname, '..');

function runBench(scriptRel, outName) {
  const out = path.join(os.tmpdir(), outName);
  const r = spawnSync(process.execPath, [path.join(pluginRoot, scriptRel), '--out', out], {
    encoding: 'utf8',
    cwd: pluginRoot,
  });
  assert.equal(r.status, 0, `${scriptRel} failed:\n${r.stderr || r.stdout}`);
  const payload = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(out, { force: true });
  return payload;
}

describe('objective-evidence bench units', () => {
  it('transcript-descent meets 1–2% L3 target', () => {
    const p = runBench('scripts/bench/run-transcript-descent.cjs', 'tx-descent-test.json');
    assert.equal(p.eval_status, 'evaluated');
    assert.equal(p.target_met, true);
    assert.ok(p.multiplier <= p.target_multiplier);
  });

  it('implementation-entry skip_llm meets 1–2% L3 target', () => {
    const p = runBench('scripts/bench/run-implementation-entry.cjs', 'impl-entry-test.json');
    assert.equal(p.skip_llm_exploration, true);
    assert.equal(p.target_met, true);
    assert.ok(p.multiplier <= p.target_multiplier);
  });

  it('organic-portfolio summary reports live ladder hits', () => {
    const out = path.join(pluginRoot, 'bench', 'results', `organic-portfolio-test-${Date.now()}.json`);
    const r = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts/bench/run-organic-portfolio.cjs'), '--out', out],
      { encoding: 'utf8', cwd: pluginRoot }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const p = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(Number.isFinite(p.summary.live_ladder_hits));
    assert.ok(Number.isFinite(p.summary.live_captured));
    fs.rmSync(out, { force: true });
  });

  it('consumer-repo descent meets 1–2% L3 target outside pack root', () => {
    const p = runBench('scripts/bench/run-consumer-repo-descent.cjs', 'consumer-repo-test.json');
    assert.equal(p.isolated_from_pack, true);
    assert.equal(p.memory_sqlite, true);
    assert.equal(p.skip_llm_exploration, true);
    assert.equal(p.target_met, true);
    assert.ok(p.multiplier <= p.target_multiplier);
    assert.equal(p.project_skill_scaffolded, true);
    assert.equal(p.project_skill_evaluated, true);
  });

  it('consumer fleet readiness gate passes with 3 organic work items in tmp repo', () => {
    const p = runBench('scripts/bench/run-consumer-fleet-readiness.cjs', 'consumer-fleet-test.json');
    assert.equal(p.isolated_from_pack, true);
    assert.equal(p.organic_live, 3);
    assert.equal(p.fleet_submission_ready, true);
    assert.equal(p.target_met, true);
    assert.ok(p.portfolio_multiplier <= p.target_multiplier);
  });

  it('fleet-submit→ingest e2e passes in isolated tmp roots', () => {
    const p = runBench('scripts/bench/run-fleet-submit-ingest-e2e.cjs', 'fleet-e2e-test.json');
    assert.equal(p.submit_ok, true);
    assert.equal(p.ingest_ok, true);
    assert.equal(p.target_met, true);
    assert.equal(p.maintainer_archived, 1);
    assert.ok(p.pack_fleet_submissions_independent >= 0);
  });

  it('maintainer dogfood archives bench passes with ≥3 excluded submissions', () => {
    const p = runBench('scripts/bench/run-fleet-archives-dogfood.cjs', 'fleet-arch-dog-test.json');
    assert.ok(p.archived_total >= 3);
    assert.ok(p.independent_consumers >= 3);
    assert.ok(p.maintainer_dogfood >= 3);
    assert.equal(p.target_met, true);
    assert.equal(p.fleet_scale_met, true);
  });
});
