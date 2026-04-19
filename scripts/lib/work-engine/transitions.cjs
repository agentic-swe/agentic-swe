'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isTransitionAllowedForTrack, normalizeTrack } = require('./tracks.cjs');

/** @type {Map<string, Set<string>>} */
const edgeCache = new Map();

function loadEdges(pluginRoot) {
  const resolved = path.resolve(pluginRoot);
  if (edgeCache.has(resolved)) return edgeCache.get(resolved);
  const p = path.join(resolved, 'state-machine.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const canonicalEdges = new Set();
  for (const pair of raw.edges || []) {
    if (Array.isArray(pair) && pair.length === 2) {
      canonicalEdges.add(`${pair[0]}\0${pair[1]}`);
    }
  }
  edgeCache.set(resolved, canonicalEdges);
  return canonicalEdges;
}

/**
 * @param {string} pluginRoot repo root when plugin is dev-cloned
 * @param {string} from
 * @param {string} to
 * @param {string|null|undefined} pipelineTrack
 */
function assertBaseEdge(pluginRoot, from, to) {
  const edges = loadEdges(pluginRoot);
  const key = `${from}\0${to}`;
  if (!edges.has(key)) {
    return { ok: false, code: 'EDGE_NOT_IN_GRAPH', message: `transition ${from} → ${to} is not in state-machine.json` };
  }
  return { ok: true };
}

/**
 * @param {string} pluginRoot
 * @param {string} from
 * @param {string} to
 * @param {string|null|undefined} pipelineTrack
 */
function assertTransition(pluginRoot, from, to, pipelineTrack) {
  const base = assertBaseEdge(pluginRoot, from, to);
  if (!base.ok) return base;

  const track = normalizeTrack(pipelineTrack);
  const filtered = isTransitionAllowedForTrack(from, to, pipelineTrack);
  if (!filtered.allowed) {
    return {
      ok: false,
      code: 'EDGE_FORBIDDEN_FOR_TRACK',
      message: `${filtered.reason} (effective track: ${track})`,
    };
  }
  return { ok: true };
}

module.exports = {
  loadEdges,
  assertBaseEdge,
  assertTransition,
  normalizeTrack,
};
