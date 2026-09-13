'use strict';

const { loadStore } = require('./promotion.cjs');

/**
 * Evaluated L0/L1 procedures for prime/context-pack (advisory).
 * @param {string} projectRoot
 * @param {number} [limit]
 */
function listMuscleMemoryRows(projectRoot, limit = 8) {
  let data;
  try {
    data = loadStore(projectRoot);
  } catch {
    return [];
  }
  const rows = [];
  for (const p of data.procedures || []) {
    if (p.eval_status === 'unevaluated') continue;
    if (p.tier !== 'L0' && p.tier !== 'L1') continue;
    const command = p.procedure?.verify?.[0]?.command || p.procedure?.actions?.[0]?.command;
    if (!command) continue;
    rows.push({
      tier: p.tier,
      eval_status: p.eval_status,
      command: String(command).slice(0, 120),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

/**
 * @param {string} projectRoot
 * @returns {string} markdown or empty
 */
function muscleMemoryDigestMarkdown(projectRoot) {
  const rows = listMuscleMemoryRows(projectRoot);
  if (!rows.length) return '';
  const lines = [
    '### Muscle memory (evaluated procedures)',
    '',
    'Replay these instead of re-deriving verify steps. Unevaluated procedures are omitted.',
    '',
  ];
  for (const r of rows) {
    lines.push(`- **${r.tier}** \`${r.command}\` [${r.eval_status}]`);
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = { listMuscleMemoryRows, muscleMemoryDigestMarkdown };
