'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isIndependentFleetSubmission } = require('./seed-organic-work.cjs');

function listArchivedSubmissions(pluginRoot) {
  const dir = path.join(path.resolve(pluginRoot), 'bench', 'results', 'fleet-submissions');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * @param {string} pluginRoot
 * @param {{ forFleetScale?: boolean }} [opts]
 */
function summarizeFleetSubmissions(pluginRoot, opts = {}) {
  const archived = listArchivedSubmissions(pluginRoot);
  const forFleetScale = opts.forFleetScale === true;
  const scaleSet = archived.filter(isIndependentFleetSubmission);
  const set = forFleetScale ? scaleSet : archived;
  const consumers = new Set();
  for (const s of set) {
    if (s.project_root) consumers.add(path.resolve(s.project_root));
  }
  const independentConsumers = new Set();
  for (const s of scaleSet) {
    if (s.project_root) independentConsumers.add(path.resolve(s.project_root));
  }
  return {
    archived: set.length,
    archived_independent: scaleSet.length,
    distinct_consumers: consumers.size,
    distinct_independent_consumers: independentConsumers.size,
    consumer_roots: [...consumers],
    independent_consumer_roots: [...independentConsumers],
  };
}

function findArchivesByGitOrigin(pluginRoot, origin) {
  if (!origin) return [];
  const norm = String(origin).trim().replace(/\.git$/, '').toLowerCase();
  return listArchivedSubmissions(pluginRoot).filter((s) => {
    const o = s.git?.origin;
    if (!o) return false;
    return String(o).trim().replace(/\.git$/, '').toLowerCase() === norm;
  });
}

module.exports = {
  listArchivedSubmissions,
  summarizeFleetSubmissions,
  findArchivesByGitOrigin,
  isIndependentFleetSubmission,
};
