'use strict';

const PROSE =
  /\b(to verify|and node|for any|registry is|account with|dependencies|must match|rights to|global install)\b/i;

/**
 * A verify command is reusable only when it is a real invocation, not transcript prose.
 * @param {string} command
 */
function isWellFormedCommand(command) {
  const cmd = String(command || '').trim().replace(/\s+/g, ' ');
  if (cmd.length < 6 || cmd.length > 160) return false;
  if ((cmd.match(/"/g) || []).length % 2 !== 0) return false;
  if (cmd.includes('[') || cmd.includes(']')) return false;
  if (/[.!?]$/.test(cmd) && !/\.(js|cjs|mjs|sh|json)$/.test(cmd)) return false;
  if (PROSE.test(cmd)) return false;
  if (/^npm (test|ci|whoami|publish|login)\b/.test(cmd)) return !/\b(to|and|with|for|the)\b/i.test(cmd);
  if (/^npm run [\w:.-]+(\s+--[\w=.-]+)*$/.test(cmd)) return true;
  if (/^npm run [\w:.-]+ --prefix [\w./-]+$/.test(cmd)) return true;
  if (/^node --test (\S+\.(?:js|cjs|mjs))(?: \S+\.(?:js|cjs|mjs))*$/.test(cmd)) return true;
  if (/^node (?:scripts|test)\/[\w./-]+\.(?:js|cjs|mjs)(?: [\w./:=-]+)*$/.test(cmd)) return true;
  if (/^bash scripts\/[\w./-]+\.sh(?: [\w.-]+)*$/.test(cmd)) return true;
  return false;
}

module.exports = { isWellFormedCommand };
