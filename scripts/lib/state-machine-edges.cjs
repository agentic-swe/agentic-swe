'use strict';

/**
 * Parse the first fenced transition block in CLAUDE.md (lines with ->).
 * Used by tests and optional verify scripts to prevent drift vs repo-root state-machine.json.
 */

function extractTransitionLines(claudeBody) {
  const lines = claudeBody.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '```' && i + 1 < lines.length && lines[i + 1].includes('->')) {
      const out = [];
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '```') break;
        const t = lines[j].trim();
        if (t.includes('->')) out.push(t);
      }
      return out;
    }
  }
  throw new Error('state machine fenced block not found in CLAUDE.md');
}

/** @returns {Set<string>} keys "from\0to" */
function edgeSetFromLines(lines) {
  const edges = new Set();
  for (const line of lines) {
    const parts = line.split('->').map((s) => s.trim());
    if (parts.length < 2) continue;
    const from = parts[0];
    for (const dest of parts[1].split('|').map((s) => s.trim())) {
      if (dest) edges.add(`${from}\0${dest}`);
    }
  }
  return edges;
}

/** @param {{ edges: [string, string][] }} canonical */
function edgeSetFromCanonical(canonical) {
  const edges = new Set();
  if (!canonical.edges || !Array.isArray(canonical.edges)) {
    throw new Error('state-machine.json missing edges array');
  }
  for (const pair of canonical.edges) {
    if (!Array.isArray(pair) || pair.length !== 2) {
      throw new Error('each edge must be [from, to]');
    }
    edges.add(`${pair[0]}\0${pair[1]}`);
  }
  return edges;
}

module.exports = {
  extractTransitionLines,
  edgeSetFromLines,
  edgeSetFromCanonical,
};
