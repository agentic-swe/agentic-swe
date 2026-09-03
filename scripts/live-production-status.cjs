#!/usr/bin/env node
/**
 * Report live production evidence status for proven_at_scale claim.
 *
 * Usage:
 *   node scripts/live-production-status.cjs [--project-root dir] [--json]
 */
'use strict';

const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const {
  aggregateProductionTierTotals,
  productionPortfolioMultiplier,
} = require('./lib/bench/production-tier-totals.cjs');
const { aggregateOrganicSessionUsd } = require('./lib/bench/session-usd-portfolio.cjs');

const TARGET = 0.02;

function main() {
  const pluginRoot = getDefaultPluginRoot();
  let projectRoot = pluginRoot;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--project-root') projectRoot = path.resolve(process.argv[++i]);
  }
  const json = process.argv.includes('--json');

  const production = aggregateProductionTierTotals(projectRoot);
  const portfolio = productionPortfolioMultiplier(production);
  const sessionUsd = aggregateOrganicSessionUsd(projectRoot, pluginRoot);
  const liveItems = production.sources?.live ?? 0;
  const fixtureItems = production.sources?.fixtures ?? 0;
  const liveOk = liveItems >= 1 && portfolio.portfolio_multiplier <= TARGET;

  const payload = {
    ok: true,
    project_root: projectRoot,
    live_work_items: liveItems,
    fixture_work_items: fixtureItems,
    production_portfolio_multiplier: portfolio.portfolio_multiplier,
    target_multiplier: TARGET,
    live_production_verified: liveOk,
    claim_status: liveOk ? 'proven_at_scale' : liveItems ? 'live_below_target' : 'no_live_worklogs',
    next_steps: liveOk
      ? []
      : liveItems
        ? ['Reduce frontier tier usage on completed work items (descent-first before LLM delegation)']
        : [
            'Run /work items through validation→pr-creation (records tier_totals via Stop hook + validation descent)',
            'Optional maintainer bootstrap: npm run dogfood:live-worklogs (writes .worklogs/ under project root)',
          ],
    tier_totals: production.tier_totals,
    organic_session_usd: sessionUsd.summary,
    organic_session_usd_contract: sessionUsd.measurement_contract,
  };

  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`live-production-status: ${payload.claim_status}`);
    console.log(`  live work items: ${liveItems}, fixtures: ${fixtureItems}`);
    console.log(
      `  production portfolio: ${(portfolio.portfolio_multiplier * 100).toFixed(2)}% (target ≤${TARGET * 100}%)`
    );
    if (sessionUsd.summary.billed_sessions > 0) {
      console.log(
        `  organic session USD (verify-replay): ${(sessionUsd.summary.session_usd_multiplier * 100).toFixed(3)}% across ${sessionUsd.summary.billed_sessions} billed /work item(s)`
      );
      console.log(`    (${sessionUsd.measurement_contract})`);
    } else if (sessionUsd.summary.organic_items > 0) {
      console.log('  organic session USD: no billed usage_totals on live /work items yet');
    }
    if (payload.next_steps.length) {
      console.log('  next steps:');
      for (const s of payload.next_steps) console.log(`    - ${s}`);
    }
  }
}

main();
