'use strict';

const { loadStore, saveStore } = require('./promotion.cjs');

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

function verifyCommand(rec) {
  return rec?.procedure?.verify?.[0]?.command || rec?.procedure?.actions?.[0]?.command || '';
}

function readFiles(rec) {
  const actions = rec?.procedure?.actions || [];
  return actions
    .filter((action) => action && action.type === 'READ_FILE' && action.path)
    .map((action) => action.path)
    .sort();
}

function dedupeKey(rec) {
  const cmd = String(verifyCommand(rec)).trim().replace(/\s+/g, ' ');
  const cwd = rec?.procedure?.verify?.[0]?.cwd || '';
  return `${cmd}\n${cwd}\n${readFiles(rec).join('|')}`;
}

function rank(rec) {
  let score = rec.success_count || 0;
  if (rec.eval_status === 'evaluated') score += 100;
  if (rec.tier === 'L0') score += 20;
  if (rec.human_approved) score += 5;
  return score;
}

function quarantine(rec, quality, reason) {
  rec.eval_status = 'quarantined';
  rec.quality = quality;
  rec.quarantine_reason = reason;
}

/**
 * Quarantine malformed and duplicate procedure records. Does not delete history.
 * @param {string} projectRoot
 */
function quarantineProcedures(projectRoot) {
  const data = loadStore(projectRoot);
  const procedures = data.procedures || [];
  let rejected = 0;
  let duplicates = 0;

  for (const rec of procedures) {
    if (rec.eval_status === 'quarantined') continue;
    if (!isWellFormedCommand(verifyCommand(rec))) {
      quarantine(rec, 'rejected', 'malformed verify command');
      rejected++;
    }
  }

  const groups = new Map();
  for (const rec of procedures) {
    if (rec.eval_status === 'quarantined') continue;
    const key = dedupeKey(rec);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => rank(b) - rank(a));
    for (const rec of group.slice(1)) {
      quarantine(rec, 'duplicate', 'duplicate verify command');
      duplicates++;
    }
  }

  if (rejected || duplicates) saveStore(projectRoot, data);
  return {
    ok: true,
    scanned: procedures.length,
    rejected,
    duplicates,
    kept: procedures.filter((rec) => rec.eval_status !== 'quarantined').length,
  };
}

module.exports = {
  isWellFormedCommand,
  quarantineProcedures,
};
