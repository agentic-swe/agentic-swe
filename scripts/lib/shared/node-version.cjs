'use strict';

/** Pack floor matching package.json engines.node (PD-48 C1 / ADR-004b). */
const NODE_FLOOR = { major: 22, minor: 13, patch: 0 };
const NODE_FLOOR_LABEL = '22.13';

/**
 * Parse a Node version string (e.g. process.versions.node) into integers.
 * Non-numeric segments become 0. Leading "v" is accepted.
 * @param {string} version
 * @returns {{ major: number, minor: number, patch: number }}
 */
function parseNodeVersion(version) {
  const raw = String(version == null ? '' : version).trim().replace(/^v/i, '');
  const parts = raw.split('.').map((p) => {
    const n = parseInt(String(p).replace(/[^0-9].*$/, ''), 10);
    return Number.isFinite(n) ? n : 0;
  });
  return {
    major: parts[0] || 0,
    minor: parts[1] || 0,
    patch: parts[2] || 0,
  };
}

/**
 * True when version is at or above the pack Node floor (default 22.13.0).
 * Pure compare — does not inspect the running binary.
 * @param {string} version
 * @param {{ major: number, minor: number, patch: number }} [floor]
 */
function meetsNodeFloor(version, floor = NODE_FLOOR) {
  const v = parseNodeVersion(version);
  const f = floor || NODE_FLOOR;
  if (v.major !== f.major) return v.major > f.major;
  if (v.minor !== f.minor) return v.minor > f.minor;
  return v.patch >= f.patch;
}

module.exports = {
  NODE_FLOOR,
  NODE_FLOOR_LABEL,
  parseNodeVersion,
  meetsNodeFloor,
};
