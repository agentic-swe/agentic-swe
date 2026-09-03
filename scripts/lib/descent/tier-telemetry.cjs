'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TELEMETRY_FILE = '.agentic-swe/tier-telemetry.json';

function loadTelemetry(projectRoot) {
  const p = path.join(projectRoot, TELEMETRY_FILE);
  if (!fs.existsSync(p)) {
    return { hits: { L0: 0, L1: 0, L2: 0, L3: 0 }, attempts: { L0: 0, L1: 0, L2: 0, L3: 0 } };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveTelemetry(projectRoot, data) {
  const p = path.join(projectRoot, TELEMETRY_FILE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

/**
 * Record a ladder tier attempt/hit.
 * @param {string} projectRoot
 * @param {string} tier L0|L1|L2|L3
 * @param {boolean} hit
 */
function recordTierEvent(projectRoot, tier, hit) {
  const data = loadTelemetry(projectRoot);
  if (!data.hits[tier]) data.hits[tier] = 0;
  if (!data.attempts[tier]) data.attempts[tier] = 0;
  data.attempts[tier]++;
  if (hit) data.hits[tier]++;
  data.updated_at = new Date().toISOString();
  saveTelemetry(projectRoot, data);
  return data;
}

function tierHitRatesFromTelemetry(projectRoot) {
  const data = loadTelemetry(projectRoot);
  const rates = {};
  for (const tier of ['L0', 'L1', 'L2', 'L3']) {
    const att = data.attempts[tier] || 0;
    const hits = data.hits[tier] || 0;
    rates[tier] = att ? Number((hits / att).toFixed(4)) : 0;
  }
  return { ...rates, raw: data };
}

module.exports = {
  TELEMETRY_FILE,
  loadTelemetry,
  recordTierEvent,
  tierHitRatesFromTelemetry,
};
