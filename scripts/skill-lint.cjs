#!/usr/bin/env node
/**
 * Lint Agent Skills under skills/<name>/SKILL.md
 * Extends catalog governance with eval_status and spec constraints.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  extractFrontmatter,
  parseSimpleFields,
} = require('./lib/catalog/parse-frontmatter.cjs');

const root = path.join(__dirname, '..');
const skillsRoot = path.join(root, 'skills');
const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/;
const EVAL_STATUSES = new Set(['unevaluated', 'evaluated', 'deprecated']);

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
  for (const dirName of dirs) {
    const skillPath = path.join(skillsRoot, dirName, 'SKILL.md');
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
      errors.push(`${rel}: eval_status must be unevaluated|evaluated|deprecated; got "${evalStatus}"`);
    }
    if (evalStatus === 'evaluated' && !meta.eval_ref) {
      errors.push(`${rel}: evaluated skills require metadata.eval_ref golden eval reference`);
    }
    if (!meta.version) errors.push(`${rel}: metadata.version required`);
  }

  if (errors.length) {
    console.error('skill-lint: FAILED\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  console.log(`skill-lint: OK (${dirs.length} skills)`);
}

lint();
