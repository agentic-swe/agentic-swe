'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { extractFrontmatter } = require('../catalog/parse-frontmatter.cjs');
const { parseMetadataMap } = require('./golden-eval.cjs');

const SKILL_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * @param {string} skillsRoot
 * @param {'pack'|'project'} origin
 */
function readSkillsDir(skillsRoot, origin) {
  if (!fs.existsSync(skillsRoot)) return [];
  const out = [];
  for (const d of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const skillPath = path.join(skillsRoot, d.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    const raw = fs.readFileSync(skillPath, 'utf8');
    const ex = extractFrontmatter(raw);
    if (!ex) continue;
    const meta = parseMetadataMap(ex.block);
    const descMatch = ex.block.match(/^description:\s*"(.*)"/m);
    out.push({
      name: d.name,
      path: skillPath,
      description: descMatch ? descMatch[1] : '',
      kind: meta.kind || 'unknown',
      eval_status: meta.eval_status || 'unevaluated',
      eval_ref: meta.eval_ref || '',
      tier: meta.tier || 'L2',
      origin,
    });
  }
  return out;
}

/**
 * List pack skills plus optional project-local `.agentic-swe/skills` (project overrides pack).
 * @param {string} pluginRoot
 * @param {string} [projectRoot]
 */
function listSkills(pluginRoot, projectRoot) {
  const pack = readSkillsDir(path.join(path.resolve(pluginRoot), 'skills'), 'pack');
  if (!projectRoot) return pack.sort((a, b) => a.name.localeCompare(b.name));

  const project = readSkillsDir(path.join(path.resolve(projectRoot), '.agentic-swe', 'skills'), 'project');
  const byName = new Map(pack.map((s) => [s.name, s]));
  for (const s of project) byName.set(s.name, s);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function projectSkillPath(projectRoot, skillName) {
  return path.join(path.resolve(projectRoot), '.agentic-swe', 'skills', skillName, 'SKILL.md');
}

/**
 * Scaffold an unevaluated project-local skill from a mined procedure ritual.
 * @param {{ projectRoot: string, skillName: string, verifyCommand: string, source?: string }} opts
 */
function scaffoldProjectSkillFromRitual(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const skillName = String(opts.skillName || '').toLowerCase();
  const verifyCommand = String(opts.verifyCommand || '').trim();
  if (!SKILL_NAME_RE.test(skillName)) {
    return { ok: false, error: `invalid skill name: ${skillName}` };
  }
  if (!verifyCommand) {
    return { ok: false, error: 'verifyCommand required' };
  }

  const skillPath = projectSkillPath(projectRoot, skillName);
  if (fs.existsSync(skillPath)) {
    return { ok: true, skipped: true, skill: skillName, path: skillPath };
  }

  const source = opts.source || 'procedure-ritual';
  const desc = `Team ritual skill mined from ${source} (${verifyCommand.slice(0, 80)}).`;
  const meta = {
    tier: 'L2',
    eval_status: 'unevaluated',
    eval_ref: '',
    version: '1.0.0',
    provenance: 'ritual-scaffold',
    kind: 'command',
    ritual_source: source,
  };
  const metaLines = Object.entries(meta)
    .map(([k, v]) => `  ${k}: "${String(v).replace(/"/g, '\\"')}"`)
    .join('\n');
  const fm = `---
name: ${skillName}
description: "${desc.replace(/"/g, '\\"')}"
metadata:
${metaLines}
---

# ${skillName}

Project-local skill scaffolded from an evaluated procedure \`npm run\` ritual.

## Verify ritual

\`\`\`bash
${verifyCommand}
\`\`\`

Add a golden eval task under \`bench/corpus/\` and map \`eval_ref\` before autonomous use.
`;

  fs.mkdirSync(path.dirname(skillPath), { recursive: true });
  fs.writeFileSync(skillPath, fm);
  return { ok: true, created: true, skill: skillName, path: skillPath };
}

/**
 * Scaffold project skills for procedure rituals with no matching pack/project skill.
 * @param {{ projectRoot: string, pluginRoot: string, dryRun?: boolean }} opts
 */
function scaffoldMissingRitualSkills(opts) {
  const { collectProcedureRitualSkills, resolveProcedureStoreRoot } = require('./procedure-ritual-skills.cjs');
  const { loadStore } = require('../descent/promotion.cjs');

  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const storeRoot = resolveProcedureStoreRoot({ projectRoot, pluginRoot });
  const rituals = collectProcedureRitualSkills(storeRoot);
  const known = new Set(listSkills(pluginRoot, projectRoot).map((s) => s.name));
  const data = loadStore(storeRoot);

  const results = [];
  for (const r of rituals) {
    if (known.has(r.skill)) continue;
    if (r.evaluated < 1) {
      results.push({ skill: r.skill, ok: false, skipped: true, reason: 'no evaluated procedure ritual' });
      continue;
    }
    const proc = (data.procedures || []).find(
      (p) =>
        p.eval_status === 'evaluated' &&
        new RegExp(`\\bnpm run ${r.skill}\\b`, 'i').test(p.procedure?.verify?.[0]?.command || '')
    );
    const verifyCommand = proc?.procedure?.verify?.[0]?.command || `npm run ${r.skill}`;
    const source = proc?.procedure?._meta?.source || 'procedure-ritual';
    if (opts.dryRun) {
      results.push({ skill: r.skill, ok: true, dry_run: true, verify_command: verifyCommand });
      continue;
    }
    const created = scaffoldProjectSkillFromRitual({
      projectRoot,
      skillName: r.skill,
      verifyCommand,
      source,
    });
    results.push({ ...created, verify_command: verifyCommand });
  }

  const created = results.filter((r) => r.created).length;
  if (!opts.dryRun && created > 0) {
    writeGoldenEvalSuggestions(projectRoot, results);
  }
  return { ok: true, created, total: results.length, results };
}

/**
 * Suggest golden eval mappings for newly scaffolded ritual skills.
 * @param {string} projectRoot
 * @param {Array<{ skill: string, created?: boolean, verify_command?: string }>} entries
 */
function writeGoldenEvalSuggestions(projectRoot, entries) {
  const suggestions = {};
  for (const e of entries) {
    if (!e.skill || !e.created) continue;
    const cmd = String(e.verify_command || '');
    if (/^node --test test\//.test(cmd)) {
      suggestions[e.skill] = {
        pack_eval_ref: 'bench/corpus/oracle-verify-sanity',
        verify_command: cmd,
        note: 'Copy into .agentic-swe/skill-golden-eval.json then run skill-eval promote-rituals',
      };
    } else if (/^npm run [a-z][a-z0-9-]*$/.test(cmd)) {
      suggestions[e.skill] = {
        verify_command: cmd,
        note: 'Add a project bench/corpus task and map eval_ref in skill-golden-eval.json',
      };
    }
  }
  if (!Object.keys(suggestions).length) return null;
  const agenticDir = path.join(projectRoot, '.agentic-swe');
  fs.mkdirSync(agenticDir, { recursive: true });
  const outPath = path.join(agenticDir, 'skill-golden-eval.suggestions.json');
  fs.writeFileSync(outPath, JSON.stringify({ version: 1, skills: suggestions }, null, 2));
  return outPath;
}

module.exports = {
  SKILL_NAME_RE,
  readSkillsDir,
  listSkills,
  projectSkillPath,
  scaffoldProjectSkillFromRitual,
  scaffoldMissingRitualSkills,
  writeGoldenEvalSuggestions,
};
