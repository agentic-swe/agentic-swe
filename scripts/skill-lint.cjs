#!/usr/bin/env node
/**
 * Lint Agent Skills under skills/<name>/SKILL.md
 * Extends catalog governance with eval_status, spec constraints, and
 * ADR-010 SkillManifest validation when skills/<name>/manifest.json is present (AE-024a).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  extractFrontmatter,
  parseSimpleFields,
} = require('./lib/catalog/parse-frontmatter.cjs');
const { LINT_ONLY_EVAL_REFS } = require('./lib/skills/golden-eval.cjs');
const { loadManifestFile, validateSkillManifest } = require('./lib/skills/skill-manifest.cjs');

function resolveRoot() {
  const idx = process.argv.indexOf('--plugin-root');
  if (idx !== -1 && process.argv[idx + 1]) return path.resolve(process.argv[idx + 1]);
  return path.join(__dirname, '..');
}

const root = resolveRoot();
const skillsRoot = path.join(root, 'skills');
const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/;
const EVAL_STATUSES = new Set(['unevaluated', 'lint_passed', 'evaluated', 'deprecated']);

function parseMetadata(block) {
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

function lint() {
  if (!fs.existsSync(skillsRoot)) {
    console.error('skill-lint: skills/ missing — run node scripts/generate-skills.cjs');
    process.exit(1);
  }

  const dirs = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (!dirs.length) {
    console.error('skill-lint: no skills found');
    process.exit(1);
  }

  const errors = [];
  let structuredCount = 0;
  for (const dirName of dirs) {
    const skillDir = path.join(skillsRoot, dirName);
    const skillPath = path.join(skillDir, 'SKILL.md');
    const rel = path.relative(root, skillPath);
    if (!fs.existsSync(skillPath)) {
      errors.push(`${rel}: missing SKILL.md`);
      continue;
    }
    const raw = fs.readFileSync(skillPath, 'utf8');
    const ex = extractFrontmatter(raw);
    if (!ex) {
      errors.push(`${rel}: missing frontmatter`);
      continue;
    }
    const fm = parseSimpleFields(ex.block);
    const name = fm.name && String(fm.name).trim();
    if (!name) errors.push(`${rel}: missing name`);
    else {
      if (name !== dirName) errors.push(`${rel}: name "${name}" must match directory "${dirName}"`);
      if (!SKILL_NAME_RE.test(name)) errors.push(`${rel}: invalid name "${name}"`);
    }
    const desc = fm.description != null ? String(fm.description).trim() : '';
    if (!desc) errors.push(`${rel}: missing description`);
    else if (desc.length > 1024) errors.push(`${rel}: description exceeds 1024 chars (${desc.length})`);

    const meta = parseMetadata(ex.block);
    const evalStatus = meta.eval_status || 'unevaluated';
    if (!EVAL_STATUSES.has(evalStatus)) {
      errors.push(`${rel}: eval_status must be unevaluated|lint_passed|evaluated|deprecated; got "${evalStatus}"`);
    }
    if ((evalStatus === 'evaluated' || evalStatus === 'lint_passed') && !meta.eval_ref) {
      errors.push(`${rel}: ${evalStatus} skills require metadata.eval_ref golden eval reference`);
    }
    if (evalStatus === 'evaluated' && LINT_ONLY_EVAL_REFS.has(meta.eval_ref)) {
      errors.push(`${rel}: eval_ref ${meta.eval_ref} is lint-only; eval_status must be lint_passed, not evaluated`);
    }
    if (!meta.version) errors.push(`${rel}: metadata.version required`);

    // AE-024a: structured SkillManifest sidecar (optional until migration).
    const loaded = loadManifestFile(skillDir);
    if (loaded) {
      structuredCount += 1;
      const manRel = path.relative(root, path.join(skillDir, 'manifest.json'));
      if (!loaded.ok) {
        for (const e of loaded.errors) errors.push(`${manRel}: ${e}`);
      } else if (loaded.manifest.name && name && loaded.manifest.name !== name) {
        errors.push(`${manRel}: name "${loaded.manifest.name}" must match SKILL.md / directory "${name}"`);
      }
    }
  }

  // Optional extra manifests passed as argv files (fixtures / CI).
  const skip = new Set();
  const rootFlag = process.argv.indexOf('--plugin-root');
  if (rootFlag !== -1) {
    skip.add(rootFlag);
    skip.add(rootFlag + 1);
  }
  const fileArgs = process.argv
    .map((a, i) => ({ a, i }))
    .filter(({ a, i }) => a.endsWith('.json') && !skip.has(i))
    .map(({ a }) => a);
  for (const fileArg of fileArgs) {
    const abs = path.resolve(fileArg);
    const rel = path.relative(process.cwd(), abs) || abs;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (err) {
      errors.push(`${rel}: ${err.message}`);
      continue;
    }
    const check = validateSkillManifest(parsed);
    if (!check.ok) {
      for (const e of check.errors) errors.push(`${rel}: ${e}`);
    }
  }

  if (errors.length) {
    console.error('skill-lint: FAILED\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  console.log(
    `skill-lint: OK (${dirs.length} skills` +
      (structuredCount ? `, ${structuredCount} structured manifests` : '') +
      ')'
  );
}

lint();
