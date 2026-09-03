'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NPM_RUN_SKILL_RE = /\bnpm run ([a-z][a-z0-9-]*)\b/i;

/**
 * Extract skill name from a verify command when it is `npm run <skill>`.
 * @param {string} command
 * @returns {string|null}
 */
function parseNpmRunSkill(command) {
  const m = String(command || '').match(NPM_RUN_SKILL_RE);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Aggregate evaluated/unevaluated procedure counts per `npm run` skill ritual.
 * @param {string} storeRoot project or plugin root containing `.agentic-swe/procedures.json`
 */
function collectProcedureRitualSkills(storeRoot) {
  const { loadStore } = require('../descent/promotion.cjs');
  const data = loadStore(path.resolve(storeRoot));
  const bySkill = new Map();

  for (const p of data.procedures || []) {
    const cmd = p.procedure?.verify?.[0]?.command || '';
    const skill = parseNpmRunSkill(cmd);
    if (!skill) continue;
    if (!bySkill.has(skill)) {
      bySkill.set(skill, { skill, evaluated: 0, unevaluated: 0, sources: new Set() });
    }
    const row = bySkill.get(skill);
    if (p.eval_status === 'evaluated') row.evaluated++;
    else row.unevaluated++;
    const src = p.procedure?._meta?.source;
    if (src) row.sources.add(src);
  }

  return [...bySkill.values()]
    .map((r) => ({
      skill: r.skill,
      evaluated: r.evaluated,
      unevaluated: r.unevaluated,
      sources: [...r.sources].sort(),
    }))
    .sort((a, b) => a.skill.localeCompare(b.skill));
}

/**
 * Resolve which root holds procedures for a consumer project.
 * @param {{ projectRoot: string, pluginRoot: string }} opts
 */
function resolveProcedureStoreRoot(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const storePath = path.join(projectRoot, '.agentic-swe', 'procedures.json');
  return fs.existsSync(storePath) ? projectRoot : pluginRoot;
}

/**
 * Evaluated `npm run` ritual skill names (for routing / doctor / fleet status).
 * @param {{ projectRoot: string, pluginRoot: string, limit?: number }} opts
 */
function listEvaluatedRitualSkillNames(opts) {
  const storeRoot = resolveProcedureStoreRoot(opts);
  return collectProcedureRitualSkills(storeRoot)
    .filter((r) => r.evaluated > 0)
    .map((r) => r.skill)
    .slice(0, opts.limit || 16);
}

/**
 * Procedure counts by eval status (doctor summary).
 * @param {{ projectRoot: string, pluginRoot: string }} opts
 */
function summarizeProcedures(opts) {
  const storeRoot = resolveProcedureStoreRoot(opts);
  const { loadStore } = require('../descent/promotion.cjs');
  const data = loadStore(storeRoot);
  let evaluated = 0;
  let unevaluated = 0;
  const verify_samples = [];
  for (const p of data.procedures || []) {
    if (p.eval_status === 'evaluated') {
      evaluated++;
      const cmd = p.procedure?.verify?.[0]?.command;
      if (cmd && verify_samples.length < 5) verify_samples.push(String(cmd).slice(0, 120));
    } else unevaluated++;
  }
  return {
    evaluated,
    unevaluated,
    ritual_skills: listEvaluatedRitualSkillNames(opts),
    verify_samples,
  };
}

module.exports = {
  NPM_RUN_SKILL_RE,
  parseNpmRunSkill,
  collectProcedureRitualSkills,
  resolveProcedureStoreRoot,
  listEvaluatedRitualSkillNames,
  summarizeProcedures,
};
