'use strict';

const { summarizeFleetSubmissions } = require('./submission-archive.cjs');

const FLEET_SCALE_TARGET = 3;

/**
 * Evaluate fleet-scale-independent requirement from archived submissions.
 * @param {string} pluginRoot
 */
function evaluateFleetScaleGate(pluginRoot) {
  const scale = summarizeFleetSubmissions(pluginRoot, { forFleetScale: true });
  const met = scale.distinct_independent_consumers >= FLEET_SCALE_TARGET;
  let status = 'incomplete';
  if (met) status = 'met';
  else if (scale.distinct_independent_consumers >= 1) status = 'partial';

  return {
    target: FLEET_SCALE_TARGET,
    met,
    status,
    archived_independent: scale.archived_independent,
    distinct_independent_consumers: scale.distinct_independent_consumers,
    independent_consumer_roots: scale.independent_consumer_roots,
  };
}

module.exports = { evaluateFleetScaleGate, FLEET_SCALE_TARGET };
