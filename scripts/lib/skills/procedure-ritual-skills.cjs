'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NPM_RUN_SKILL_RE = /\b(?:npm|pnpm|yarn)\s+run\s+([a-z][a-z0-9-]*)\b/i;
const NODE_TEST_RE = /\bnode\s+(?:--test\s+)?((?:test|tests)\/[a-zA-Z0-9_./-]+\.(?:js|cjs|mjs))\b/;

/**
 * Sanitize a path basename into a skill-name-safe slug.
 * @param {string} rel
 * @returns {string|null}
 */
function skillSlugFromTestPath(rel) {
  const base = path.basename(String(rel || ''), path.extname(rel || ''));
  const stripped = base.replace(/\.(test|spec)$/i, '').toLowerCase();
  const slug = stripped.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!slug || !/^[a-z][a-z0-9-]{0,63}$/.test(slug)) return null;
  return slug;
}

/**
 * Extract skill name from a verify command when it is `npm|pnpm|yarn run <skill>`.
 * @param {string} command
 * @returns {string|null}
 */
function parseNpmRunSkill(command) {
  const m = String(command || '').match(NPM_RUN_SKILL_RE);
  return m ? m[1].toLowerCase() : null;
}

/**
 * General ritual pattern parser (beyond `npm run`).
 * @param {string} command
 * @returns {{ kind: 'npm_run'|'node_test', skill: string, command: string, test_path?: string }|null}
 */
function parseRitualPattern(command) {
  const cmd = String(command || '').replace(/\s+/g, ' ').trim();
  if (!cmd) return null;

  const npmSkill = parseNpmRunSkill(cmd);
  if (npmSkill) {
    return { kind: 'npm_run', skill: npmSkill, command: cmd };
  }

  const nodeM = cmd.match(NODE_TEST_RE);
  if (nodeM) {
    const testPath = nodeM[1].split(path.sep).join('/');
    const skill = skillSlugFromTestPath(testPath);
    if (!skill) return null;
    return { kind: 'node_test', skill, command: cmd, test_path: testPath };
  }

  return null;
}

/**
 * Aggregate evaluated/unevaluated procedure counts per ritual skill pattern.
 * Includes `npm|pnpm|yarn run` and isolated `node --test` / `node test/…` verifies.
 * @param {string} storeRoot project or plugin root containing `.agentic-swe/procedures.json`
 */
function collectProcedureRitualSkills(storeRoot) {
  const { loadStore } = require('../descent/promotion.cjs');
  const data = loadStore(path.resolve(storeRoot));
  const bySkill = new Map();

  for (const p of data.procedures || []) {
    const cmd = p.procedure?.verify?.[0]?.command || '';
    const pattern = parseRitualPattern(cmd);
    if (!pattern) continue;
    const skill = pattern.skill;
    if (!bySkill.has(skill)) {
      bySkill.set(skill, {
        skill,
        kind: pattern.kind,
        evaluated: 0,
        unevaluated: 0,
        sources: new Set(),
        commands: new Set(),
      });
    }
    const row = bySkill.get(skill);
    if (p.eval_status === 'evaluated') row.evaluated++;
    else row.unevaluated++;
    const src = p.procedure?._meta?.source || p.source;
    if (src) row.sources.add(src);
    row.commands.add(cmd);
    // Prefer npm_run kind when both appear under the same skill slug.
    if (pattern.kind === 'npm_run') row.kind = 'npm_run';
  }

  return [...bySkill.values()]
    .map((r) => ({
      skill: r.skill,
      kind: r.kind,
      evaluated: r.evaluated,
      unevaluated: r.unevaluated,
      sources: [...r.sources].sort(),
      commands: [...r.commands].sort(),
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
 * Evaluated ritual skill names (for routing / doctor / fleet status).
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
  NODE_TEST_RE,
  parseNpmRunSkill,
  parseRitualPattern,
  skillSlugFromTestPath,
  collectProcedureRitualSkills,
  resolveProcedureStoreRoot,
  listEvaluatedRitualSkillNames,
  summarizeProcedures,
};
