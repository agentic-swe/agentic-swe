'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { deepMerge } = require('../catalog/model-routing.cjs');

function envDisabled(env) {
  const v = env && env.AGENTIC_SWE_JEV;
  return v === '0' || v === 'false' || v === 'off';
}

/**
 * @param {string} pluginRoot
 * @param {string} [projectRoot]
 * @param {NodeJS.ProcessEnv} [env]
 */
function loadJevConfig(pluginRoot, projectRoot, env = process.env) {
  const defPath = path.join(pluginRoot, 'config', 'jev.default.json');
  const base = JSON.parse(fs.readFileSync(defPath, 'utf8'));
  let merged = base;
  if (projectRoot) {
    const override = path.join(projectRoot, '.agentic-swe', 'jev.json');
    if (fs.existsSync(override)) {
      const extra = JSON.parse(fs.readFileSync(override, 'utf8'));
      merged = deepMerge(base, extra);
    }
  }
  if (env && env.TYPESAFE_MODEL) merged = { ...merged, model: String(env.TYPESAFE_MODEL) };
  if (envDisabled(env)) merged = { ...merged, enabled: false };
  merged.timeout_ms = Number(merged.timeout_ms) > 0 ? Number(merged.timeout_ms) : 2000;
  merged.shortlist = Number.isFinite(Number(merged.shortlist)) ? Math.max(1, Number(merged.shortlist)) : 8;
  merged.choice_confidence_min = Number.isFinite(Number(merged.choice_confidence_min))
    ? Number(merged.choice_confidence_min)
    : 0.7;
  merged.noul_floor = Number.isFinite(Number(merged.noul_floor)) ? Number(merged.noul_floor) : 0.4;
  merged.risk_noul_caution = Number.isFinite(Number(merged.risk_noul_caution))
    ? Number(merged.risk_noul_caution)
    : 0.8;
  merged.state_cap = {
    track: 8000,
    tier: 4000,
    routing: 4000,
    ...(merged.state_cap || {}),
  };
  return merged;
}

module.exports = { loadJevConfig, envDisabled };
