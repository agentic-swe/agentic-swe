'use strict';

const { loadStore, saveStore } = require('./promotion.cjs');
const { isWellFormedCommand } = require('../memory/command-hygiene.cjs');

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
