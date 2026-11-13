'use strict';

const {
  collectProcedureRitualSkills,
  resolveProcedureStoreRoot,
} = require('./procedure-ritual-skills.cjs');
const { listSkills, scaffoldMissingRitualSkills } = require('./project-skills.cjs');
const { loadGoldenEvalMap } = require('./golden-eval.cjs');
const {
  writeCandidatePackage,
  listPackagedCandidates,
  candidatesRoot,
} = require('./candidate-package.cjs');

/**
 * True when a version candidate with ritual evidence already exists for the skill.
 * @param {string} projectRoot
 * @param {string} skillName
 */
function hasRitualVersionCandidate(projectRoot, skillName) {
  const packaged = listPackagedCandidates(projectRoot).find((c) => c.skill === skillName);
  if (!packaged || !packaged.meta) return false;
  if (packaged.meta.ritual_promote === true) return true;
  const evidencePath = require('node:path').join(packaged.path, 'evidence.json');
  return require('node:fs').existsSync(evidencePath);
}

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

    if (hasRitualVersionCandidate(projectRoot, r.skill)) {
      action = 'version_candidate_ready';
      reason =
        'Version candidate + evidence already under .agentic-swe/skills/candidates/ — human review / publishSkill (AE-033b); no frontmatter promote';
    } else if (skill.eval_status !== 'evaluated' && hasGolden && r.evaluated >= 1) {
      action = 'promote';
      reason =
        'Evaluated procedure uses npm run; run skill-eval promote-rituals to create a version candidate + evidence (AE-033b)';
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

  const order = {
    promote: 0,
    create_skill: 1,
    evaluate_procedure_first: 2,
    needs_eval_ref: 3,
    version_candidate_ready: 4,
    route_only: 5,
  };
  suggestions.sort((a, b) => (order[a.action] ?? 9) - (order[b.action] ?? 9) || a.skill.localeCompare(b.skill));

  const promoteCandidates = suggestions.filter((s) => s.action === 'promote').map((s) => s.skill);
  const scaffoldCandidates = suggestions.filter((s) => s.action === 'create_skill').map((s) => s.skill);
  return {
    store_root: storeRoot,
    ritual_skills: rituals.length,
    suggestions,
    promote_candidates: promoteCandidates,
    scaffold_candidates: scaffoldCandidates,
    version_candidate_ready: suggestions
      .filter((s) => s.action === 'version_candidate_ready')
      .map((s) => s.skill),
  };
}

/**
 * Create a version candidate + golden-eval evidence for procedure-backed promote candidates.
 * AE-033b: does NOT patch pack/project SKILL.md eval_status (frontmatter-only promote removed).
 *
 * @param {{ projectRoot: string, pluginRoot: string, dryRun?: boolean }} opts
 */
function promoteRitualSkillCandidates(opts) {
  const path = require('node:path');
  const { runGoldenEval } = require('./golden-eval.cjs');

  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot || pluginRoot);
  const summary = suggestSkillEvalFromProcedures({ projectRoot, pluginRoot });
  const results = [];

  for (const skillName of summary.promote_candidates) {
    if (opts.dryRun) {
      results.push({
        skill: skillName,
        ok: true,
        dry_run: true,
        mode: 'version_candidate',
      });
      continue;
    }

    const golden = runGoldenEval({ pluginRoot, projectRoot, skillName });
    if (!golden.ok) {
      results.push({
        ...golden,
        skill: skillName,
        ok: false,
        mode: 'version_candidate',
      });
      continue;
    }

    const ritual = (summary.suggestions || []).find((s) => s.skill === skillName);
    const verifyCommand = `npm run ${skillName}`;

    const evidence = {
      kind: 'ritual_golden_eval',
      skill: skillName,
      eval_ref: golden.eval_ref || null,
      golden_ok: true,
      created_at: new Date().toISOString(),
      pipeline: 'promoteRitualSkillCandidates',
      ae: 'AE-033b',
      note: 'Version candidate only — publishSkill + human review required; frontmatter eval_status not patched',
    };

    const packaged = writeCandidatePackage({
      projectRoot,
      candidate: {
        skill: skillName,
        verify_command: verifyCommand,
        kind: 'ritual',
        version: '0.1.0-candidate',
        eval_ref: golden.eval_ref || '',
        ritual_promote: true,
        permissions: [],
        autonomous_selection: false,
        source_evidence: [
          {
            type: 'golden_eval',
            eval_ref: golden.eval_ref || null,
            ok: true,
          },
          {
            type: 'procedure_ritual',
            evaluated_procedures: ritual ? ritual.evaluated_procedures : null,
            sources: ritual ? ritual.sources : [],
          },
        ],
        evidence,
      },
      validate: true,
      runTests: true,
    });

    if (!packaged.ok) {
      results.push({
        skill: skillName,
        ok: false,
        code: packaged.code || 'CANDIDATE_PACKAGE_FAILED',
        errors: packaged.errors || [],
        mode: 'version_candidate',
        eval_ref: golden.eval_ref,
      });
      continue;
    }

    results.push({
      skill: skillName,
      ok: true,
      mode: 'version_candidate',
      eval_ref: golden.eval_ref,
      candidate_path: packaged.path,
      candidates_root: candidatesRoot(projectRoot),
      evidence_path: path.join(packaged.path, 'evidence.json'),
      version: '0.1.0-candidate',
      frontmatter_patched: false,
    });
  }

  const passed = results.filter((r) => r.ok).length;
  return {
    ok: results.length === 0 || passed === results.length,
    promoted: passed,
    total: results.length,
    results,
    candidates: summary.promote_candidates,
    mode: 'version_candidate',
    frontmatter_promote: false,
  };
}

/**
 * Full skill self-evolution: scaffold missing rituals → version candidates when golden eval exists → ingest memory.
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
      const { ingestProjectSkills } = require('./ingest-project-skills.cjs');
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
  hasRitualVersionCandidate,
};
