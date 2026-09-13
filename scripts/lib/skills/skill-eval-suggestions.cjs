'use strict';

const {
  collectProcedureRitualSkills,
  resolveProcedureStoreRoot,
} = require('./procedure-ritual-skills.cjs');
const { listSkills, scaffoldMissingRitualSkills } = require('./project-skills.cjs');
const { loadGoldenEvalMap } = require('./golden-eval.cjs');

/**
 * Suggest skill-eval actions from team-mined procedure `npm run` rituals.
 * Closes the self-evolution loop: evolve-cycle mines rituals → suggest promote when ready.
 *
 * @param {{ projectRoot: string, pluginRoot: string }} opts
 */
function suggestSkillEvalFromProcedures(opts) {
  const projectRoot = require('node:path').resolve(opts.projectRoot);
  const pluginRoot = require('node:path').resolve(opts.pluginRoot);
  const storeRoot = resolveProcedureStoreRoot({ projectRoot, pluginRoot });
  const rituals = collectProcedureRitualSkills(storeRoot);
  const skills = listSkills(pluginRoot, projectRoot);
  const skillByName = new Map(skills.map((s) => [s.name, s]));
  const golden = loadGoldenEvalMap(pluginRoot, projectRoot);

  const suggestions = [];
  for (const r of rituals) {
    const skill = skillByName.get(r.skill);
    if (!skill) {
      if (r.evaluated >= 1) {
        suggestions.push({
          skill: r.skill,
          action: 'create_skill',
          reason:
            'Evaluated procedure ritual uses npm run but no pack/project skill exists — scaffold with skill-eval scaffold-rituals',
          evaluated_procedures: r.evaluated,
          unevaluated_procedures: r.unevaluated,
          sources: r.sources,
          skill_eval_status: null,
          has_golden_eval: false,
        });
      }
      continue;
    }

    const hasGolden = Boolean(golden[r.skill]);
    let action = 'route_only';
    let reason = 'Evaluated procedure ritual boosts skill routing';

    if (skill.eval_status !== 'evaluated' && hasGolden && r.evaluated >= 1) {
      action = 'promote';
      reason = 'Evaluated procedure uses npm run; run skill-eval run --skill … --promote';
    } else if (skill.eval_status !== 'evaluated' && hasGolden && r.unevaluated >= 1) {
      action = 'evaluate_procedure_first';
      reason = 'Procedure ritual mined but unevaluated — evaluate verify before skill promote';
    } else if (skill.eval_status !== 'evaluated' && !hasGolden) {
      action = 'needs_eval_ref';
      reason = 'Skill unevaluated and no golden eval_ref in config/skill-golden-eval.json';
    }

    suggestions.push({
      skill: r.skill,
      action,
      reason,
      evaluated_procedures: r.evaluated,
      unevaluated_procedures: r.unevaluated,
      sources: r.sources,
      skill_eval_status: skill.eval_status,
      has_golden_eval: hasGolden,
    });
  }

  const order = { promote: 0, create_skill: 1, evaluate_procedure_first: 2, needs_eval_ref: 3, route_only: 4 };
  suggestions.sort((a, b) => (order[a.action] ?? 9) - (order[b.action] ?? 9) || a.skill.localeCompare(b.skill));

  const promoteCandidates = suggestions.filter((s) => s.action === 'promote').map((s) => s.skill);
  const scaffoldCandidates = suggestions.filter((s) => s.action === 'create_skill').map((s) => s.skill);
  return {
    store_root: storeRoot,
    ritual_skills: rituals.length,
    suggestions,
    promote_candidates: promoteCandidates,
    scaffold_candidates: scaffoldCandidates,
  };
}

/**
 * Run golden eval promote for procedure-backed promote candidates.
 * @param {{ projectRoot: string, pluginRoot: string, dryRun?: boolean }} opts
 */
function promoteRitualSkillCandidates(opts) {
  const path = require('node:path');
  const { runGoldenEval, patchSkillMetadata, resolveSkillPath } = require('./golden-eval.cjs');

  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot || pluginRoot);
  const summary = suggestSkillEvalFromProcedures({ projectRoot, pluginRoot });
  const results = [];

  for (const skillName of summary.promote_candidates) {
    if (opts.dryRun) {
      results.push({ skill: skillName, ok: true, dry_run: true });
      continue;
    }
    const r = runGoldenEval({ pluginRoot, projectRoot, skillName });
    if (r.ok) {
      const skillPath = resolveSkillPath(pluginRoot, projectRoot, skillName);
      if (require('node:fs').existsSync(skillPath)) {
        patchSkillMetadata(skillPath, { eval_status: 'evaluated', eval_ref: r.eval_ref });
      }
    }
    results.push(r);
  }

  const passed = results.filter((r) => r.ok).length;
  return {
    ok: results.length === 0 || passed === results.length,
    promoted: passed,
    total: results.length,
    results,
    candidates: summary.promote_candidates,
  };
}

/**
 * Full skill self-evolution: scaffold missing rituals → promote when golden eval exists → ingest memory.
 * @param {{ projectRoot: string, pluginRoot: string, scaffold?: boolean, promote?: boolean, dryRun?: boolean, ingestMemory?: boolean }} opts
 */
async function runSkillEvolutionPipeline(opts) {
  const projectRoot = require('node:path').resolve(opts.projectRoot);
  const pluginRoot = require('node:path').resolve(opts.pluginRoot);
  const before = suggestSkillEvalFromProcedures({ projectRoot, pluginRoot });

  let scaffold = null;
  if (opts.scaffold !== false) {
    scaffold = scaffoldMissingRitualSkills({ projectRoot, pluginRoot, dryRun: opts.dryRun });
  }

  let promote = null;
  if (opts.promote !== false) {
    promote = promoteRitualSkillCandidates({ projectRoot, pluginRoot, dryRun: opts.dryRun });
  }

  const after = suggestSkillEvalFromProcedures({ projectRoot, pluginRoot });

  let ingest = null;
  if (!opts.dryRun && opts.ingestMemory !== false && (scaffold?.created || promote?.promoted)) {
    try {
      const { ingestProjectSkills } = require('../memory/ingest-scopes.cjs');
      ingest = await ingestProjectSkills({ projectRoot, pluginRoot });
    } catch {
      ingest = { ok: false };
    }
  }

  return { before, scaffold, promote, after, ingest };
}

module.exports = {
  suggestSkillEvalFromProcedures,
  promoteRitualSkillCandidates,
  scaffoldMissingRitualSkills,
  runSkillEvolutionPipeline,
};
