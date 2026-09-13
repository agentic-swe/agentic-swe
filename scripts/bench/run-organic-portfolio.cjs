#!/usr/bin/env node
/**
 * Capture procedures from organic /work items, then measure descent ladder vs L3 cold.
 *
 * Historical organic spend is often L3; this measures whether muscle memory can replay
 * their recorded verify commands. Does not rewrite historical cost_used.
 *
 * Usage:
 *   node scripts/bench/run-organic-portfolio.cjs [--out bench/results/organic-portfolio-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { tryDescentLadder, loadTierTokenEstimates } = require('../lib/descent/ladder.cjs');
const { captureOrganicWorklogs } = require('../lib/descent/capture-organic-worklogs.cjs');
const { historicalSessionAccounting, usdForWarmTokens } = require('../lib/descent/historical-session.cjs');
const { resolveVerifyCommand } = require('../lib/descent/capture-procedure.cjs');

const TARGET = 0.02;
const POLICY_COLD = 7700;
const POLICY_WARM = 1750;

async function main() {
  const pluginRoot = getDefaultPluginRoot();
  const projectRoot = pluginRoot;
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `organic-portfolio-${date}.json`);

  const capture = captureOrganicWorklogs({ projectRoot, pluginRoot, includeFixtures: true });
  const estimates = loadTierTokenEstimates(pluginRoot);
  const tasks = [];

  for (const cap of capture.captures) {
    if (!cap.ok) {
      tasks.push({
        work_id: cap.work_id,
        capture_ok: false,
        from_fixture: cap.from_fixture === true,
        reason: cap.reason,
        tier: 'L3',
      });
      continue;
    }
    const implPath = path.join(cap.work_dir, 'implementation.md');
    const validationPath = path.join(cap.work_dir, 'validation-results.md');
    const validationContent = fs.existsSync(validationPath) ? fs.readFileSync(validationPath, 'utf8') : '';
    let state = {};
    try {
      state = JSON.parse(fs.readFileSync(path.join(cap.work_dir, 'state.json'), 'utf8'));
    } catch {
      /* ignore */
    }
    const verifyCommand = cap.verifyCommand || resolveVerifyCommand({ validationContent, state });
    const files = cap.files || [cap.work_id];
    const descent = await tryDescentLadder({
      projectRoot,
      pluginRoot,
      verifyCommand,
      files,
      cwd: projectRoot,
    });
    const session = historicalSessionAccounting(state);
    const historicalInOut = Number(state.budget?.usage_totals?.output_tokens || 0) + Number(state.budget?.usage_totals?.input_tokens || 0);
    const historical = historicalInOut > 1000 ? historicalInOut : estimates.L3;
    const delivered = Number.isFinite(descent.delivered_tokens) ? descent.delivered_tokens : estimates.L3;
    const warmTokens = POLICY_WARM + delivered;
    const session_usd_warm = usdForWarmTokens(warmTokens);
    const session_usd_multiplier = session.has_session && session.usd > 0 ? session_usd_warm / session.usd : null;
    tasks.push({
      work_id: cap.work_id,
      capture_ok: true,
      from_fixture: cap.from_fixture === true,
      verifyCommand,
      action_reads: cap.read_actions || 0,
      tier: descent.tier,
      hit: descent.ok === true,
      delivered_tokens: descent.delivered_tokens,
      historical_tokens: historical,
      session,
      session_usd_warm,
      session_usd_multiplier,
      warm_vs_historical:
        historical > 0 ? (POLICY_WARM + delivered) / (POLICY_COLD + historical) : null,
    });
  }

  const measured = tasks.filter((t) => t.capture_ok);
  const hits = measured.filter((t) => t.hit);
  const liveMeasured = measured.filter((t) => t.from_fixture !== true);
  const liveHits = liveMeasured.filter((t) => t.hit);
  const fixtureMeasured = measured.filter((t) => t.from_fixture === true);
  const n = Math.max(1, measured.length);
  const cold =
    measured.reduce((s, t) => s + POLICY_COLD + (t.historical_tokens || estimates.L3), 0) / n;
  const warm =
    measured.reduce(
      (s, t) => s + POLICY_WARM + (Number.isFinite(t.delivered_tokens) ? t.delivered_tokens : estimates.L3),
      0
    ) / n;
  const multiplier = warm / cold;
  const sessionRows = measured.filter((t) => t.session?.has_session && t.session.usd > 0);
  const sessionUsdMult =
    sessionRows.length === 0
      ? null
      : sessionRows.reduce((s, t) => s + t.session_usd_multiplier, 0) / sessionRows.length;
  const tokenTarget = hits.length >= 1 && multiplier <= TARGET;
  const usdTarget = sessionUsdMult == null || sessionUsdMult <= TARGET;
  const payload = {
    generated_at: new Date().toISOString(),
    ok: true,
    measurement_contract:
      'Organic /work: capture verify + READ_FILE of declared implementation paths; ladder vs in/out tokens AND billed session USD (cache weighted). Does not claim a new feature can skip L3.',
    capture,
    tasks,
    summary: {
      items: tasks.length,
      captured: measured.length,
      capture_failed: tasks.length - measured.length,
      ladder_hits: hits.length,
      live_captured: liveMeasured.length,
      live_ladder_hits: liveHits.length,
      fixture_captured: fixtureMeasured.length,
      cold_per_task_tokens: cold,
      warm_per_task_tokens: warm,
      portfolio_multiplier: multiplier,
      session_usd_multiplier: sessionUsdMult,
      session_items_with_cost: sessionRows.length,
      target_multiplier: TARGET,
      token_target_met: tokenTarget,
      usd_target_met: usdTarget,
      target_met: tokenTarget && usdTarget,
    },
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`organic-portfolio: wrote ${outPath}`);
  console.log(
    `  ${hits.length}/${measured.length} ladder hits, token ${(multiplier * 100).toFixed(2)}%` +
      (sessionUsdMult != null ? `, session USD ${(sessionUsdMult * 100).toFixed(3)}%` : ', no billed session rows') +
      ` (target ≤${TARGET * 100}%)`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
