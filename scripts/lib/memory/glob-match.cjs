'use strict';

const { minimatch } = require('minimatch');

/**
 * @param {string} relPosix path with forward slashes
 * @param {string[]} includeGlobs
 * @param {string[]} excludeGlobs
 */
function isPathIncluded(relPosix, includeGlobs, excludeGlobs) {
  const opts = { dot: true };
  for (const g of excludeGlobs || []) {
    if (minimatch(relPosix, g, opts)) return false;
  }
  for (const g of includeGlobs || []) {
    if (minimatch(relPosix, g, opts)) return true;
  }
  return false;
}

module.exports = { isPathIncluded };
