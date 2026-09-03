'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runTaskAcceptance } = require('../bench/run-task.cjs');
const { extractFrontmatter, parseSimpleFields } = require('../catalog/parse-frontmatter.cjs');

/**
 * @param {string} block frontmatter block (without --- delimiters)
 * @returns {Record<string,string>}
 */
function parseMetadataMap(block) {
  const meta = {};
  let inMeta = false;
  for (const line of block.split('\n')) {
    if (/^metadata:\s*$/.test(line.trim())) {
      inMeta = true;
      continue;
    }
    if (inMeta) {
      const m = /^\s+([a-zA-Z0-9_-]+):\s*"(.*)"\s*$/.exec(line);
      if (m) {
        meta[m[1]] = m[2].replace(/\\"/g, '"');
        continue;
      }
      if (/^\S/.test(line)) inMeta = false;
    }
  }
  return meta;
}

/**
 * @param {string} skillPath
 * @param {{ eval_ref?: string, eval_status?: string }} patch
 */
function patchSkillMetadata(skillPath, patch) {
  const raw = fs.readFileSync(skillPath, 'utf8');
  const ex = extractFrontmatter(raw);
  if (!ex) throw new Error(`invalid frontmatter: ${skillPath}`);

  const meta = parseMetadataMap(ex.block);
  if (patch.eval_ref != null) meta.eval_ref = patch.eval_ref;
  if (patch.eval_status != null) meta.eval_status = patch.eval_status;

  const fm = parseSimpleFields(ex.block);
  const metaLines = Object.entries(meta)
    .map(([k, v]) => `  ${k}: "${String(v).replace(/"/g, '\\"')}"`)
    .join('\n');

  const descEsc = String(fm.description || '').replace(/"/g, '\\"');
  const newFm = `---
name: ${fm.name}
description: "${descEsc}"
metadata:
${metaLines}
---
`;

  fs.writeFileSync(skillPath, `${newFm}\n${ex.body.trim()}\n`);
}

/**
 * Load golden eval map from pack config, merged with project `.agentic-swe/skill-golden-eval.json`.
 * @param {string} pluginRoot
 * @param {string} [projectRoot]
 * @returns {Record<string,string>}
 */
function loadGoldenEvalMap(pluginRoot, projectRoot) {
  let skills = {};
  const p = path.join(path.resolve(pluginRoot), 'config', 'skill-golden-eval.json');
  if (fs.existsSync(p)) {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    skills = { ...(data.skills || {}) };
  }
  if (projectRoot) {
    const pp = path.join(path.resolve(projectRoot), '.agentic-swe', 'skill-golden-eval.json');
    if (fs.existsSync(pp)) {
      const proj = JSON.parse(fs.readFileSync(pp, 'utf8'));
      skills = { ...skills, ...(proj.skills || {}) };
    }
  }
  return skills;
}

function resolveSkillPath(pluginRoot, projectRoot, skillName) {
  if (projectRoot) {
    const projectPath = path.join(path.resolve(projectRoot), '.agentic-swe', 'skills', skillName, 'SKILL.md');
    if (fs.existsSync(projectPath)) return projectPath;
  }
  return path.join(path.resolve(pluginRoot), 'skills', skillName, 'SKILL.md');
}

function resolveEvalTaskDir(pluginRoot, projectRoot, evalRef) {
  const packDir = path.resolve(pluginRoot, evalRef);
  if (fs.existsSync(path.join(packDir, 'scoring.json'))) return packDir;
  if (projectRoot) {
    const projectDir = path.resolve(projectRoot, evalRef);
    if (fs.existsSync(path.join(projectDir, 'scoring.json'))) return projectDir;
  }
  return packDir;
}

/**
 * Run golden eval for one skill (pack or project-local `.agentic-swe/skills`).
 * @param {{ pluginRoot: string, projectRoot?: string, skillName: string, evalRef?: string }} opts
 */
function runGoldenEval(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = opts.projectRoot ? path.resolve(opts.projectRoot) : null;
  const skillName = opts.skillName;
  const skillPath = resolveSkillPath(pluginRoot, projectRoot, skillName);
  if (!fs.existsSync(skillPath)) {
    return { ok: false, skill: skillName, error: 'skill not found' };
  }

  let evalRef = opts.evalRef;
  if (!evalRef) {
    const map = loadGoldenEvalMap(pluginRoot, projectRoot);
    evalRef = map[skillName];
    if (!evalRef) {
      const raw = fs.readFileSync(skillPath, 'utf8');
      const ex = extractFrontmatter(raw);
      const meta = ex ? parseMetadataMap(ex.block) : {};
      evalRef = meta.eval_ref || null;
      if (!evalRef && meta.kind === 'subagent') {
        evalRef = 'bench/corpus/oracle-catalog-lint';
      }
    }
  }
  if (!evalRef) {
    return { ok: false, skill: skillName, error: 'no eval_ref configured' };
  }

  const taskDir = resolveEvalTaskDir(pluginRoot, projectRoot, evalRef);
  if (!fs.existsSync(path.join(taskDir, 'scoring.json'))) {
    return { ok: false, skill: skillName, eval_ref: evalRef, error: 'scoring.json missing' };
  }

  const acceptance = runTaskAcceptance(taskDir);
  return {
    ok: acceptance.ok,
    skill: skillName,
    eval_ref: evalRef,
    exitCode: acceptance.exitCode,
    stderr: acceptance.stderr?.slice(0, 500),
  };
}

/**
 * @param {{ pluginRoot: string, promote?: boolean, allSkills?: boolean }} opts
 */
function runAllGoldenEvals(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const map = loadGoldenEvalMap(pluginRoot);
  const skillNames = opts.allSkills
    ? fs
        .readdirSync(path.join(pluginRoot, 'skills'), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : Object.keys(map);
  const results = [];
  for (const skillName of skillNames) {
    const r = runGoldenEval({
      pluginRoot,
      skillName,
      evalRef: map[skillName] || undefined,
    });
    if (opts.promote && r.ok) {
      const skillPath = path.join(pluginRoot, 'skills', skillName, 'SKILL.md');
      if (fs.existsSync(skillPath)) {
        patchSkillMetadata(skillPath, {
          eval_status: 'evaluated',
          eval_ref: r.eval_ref,
        });
      }
    }
    results.push(r);
  }
  const passed = results.filter((r) => r.ok).length;
  return { ok: passed === results.length, passed, total: results.length, results };
}

module.exports = {
  loadGoldenEvalMap,
  resolveSkillPath,
  resolveEvalTaskDir,
  runGoldenEval,
  runAllGoldenEvals,
  patchSkillMetadata,
  parseMetadataMap,
};
