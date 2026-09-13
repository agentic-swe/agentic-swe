'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { suggestSkillEvalFromProcedures } = require('../skills/skill-eval-suggestions.cjs');
const {
  aggregateProductionTierTotals,
  productionPortfolioMultiplier,
  auditOrganicTierTotals,
} = require('../bench/production-tier-totals.cjs');

function latestJson(dir, prefix) {
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort();
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
}

/**
 * Honest fleet submission gate — never marks goal_complete.
 * @param {{ projectRoot: string, pluginRoot: string, muscleMemoryOk?: boolean }} opts
 */
function buildSubmissionReadiness(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot || pluginRoot);
  const resultsDir = path.join(pluginRoot, 'bench', 'results');
  const production = aggregateProductionTierTotals(projectRoot, { includeFixtures: false });
  const portfolio = productionPortfolioMultiplier(production);
  const organicAudit = auditOrganicTierTotals(projectRoot);
  const skillEval = suggestSkillEvalFromProcedures({ projectRoot, pluginRoot });
  const consumerDescent = latestJson(resultsDir, 'consumer-repo-descent-');

  const blockers = [];
  if (path.resolve(projectRoot) === path.resolve(pluginRoot)) {
    blockers.push('Submit from consumer repo (project_root ≠ plugin_root) for fleet credit');
    if (!consumerDescent?.target_met) {
      blockers.push('Maintainer pack needs passing bench:consumer-repo-descent artifact');
    }
  }
  if ((production.sources?.organic_live || 0) < 3) {
    blockers.push(
      `Need ≥3 organic_live /work items (have ${production.sources?.organic_live || 0})`
    );
  }
  if (organicAudit.organic >= 3 && organicAudit.with_tier_totals < 3) {
    const missing = organicAudit.missing_work_ids.slice(0, 5).join(', ');
    blockers.push(
      `Need tier_totals on ≥3 organic /work items (have ${organicAudit.with_tier_totals}; missing: ${missing || 'n/a'})`
    );
  }
  if (opts.muscleMemoryOk === false) {
    blockers.push('work-engine doctor muscle_memory checks failed');
  }
  if (portfolio.portfolio_multiplier > 0.02) {
    blockers.push('Production portfolio above 2% target');
  }
  if ((skillEval.scaffold_candidates || []).length) {
    blockers.push(`Scaffold pending: ${skillEval.scaffold_candidates.join(', ')}`);
  }
  if ((skillEval.promote_candidates || []).length) {
    blockers.push(`Promote pending: ${skillEval.promote_candidates.join(', ')}`);
  }

  return {
    fleet_submission_ready: blockers.length === 0,
    blockers,
    organic_live: production.sources?.organic_live || 0,
    tier_totals_work_items: production.work_items || 0,
    organic_with_tier_totals: organicAudit.with_tier_totals,
    organic_missing_tier_totals: organicAudit.missing_work_ids,
    portfolio_multiplier: portfolio.portfolio_multiplier,
    portfolio_target_met: portfolio.portfolio_multiplier <= 0.02,
  };
}

module.exports = { buildSubmissionReadiness, latestJson };
