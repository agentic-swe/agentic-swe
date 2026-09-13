'use strict';

const claude = require('./claude-code.cjs');
const cursor = require('./cursor.cjs');
const codex = require('./codex.cjs');
const gemini = require('./gemini.cjs');
const opencode = require('./opencode.cjs');

const HOSTS = {
  'claude-code': claude,
  cursor,
  codex,
  gemini,
  opencode,
};

/**
 * @param {object[]} actions typed actions
 * @returns {Record<string, object[]>}
 */
function translateActionsForAllHosts(actions) {
  const out = {};
  for (const [host, adapter] of Object.entries(HOSTS)) {
    out[host] = adapter.translateAll(actions);
  }
  return out;
}

module.exports = { HOSTS, translateActionsForAllHosts };
