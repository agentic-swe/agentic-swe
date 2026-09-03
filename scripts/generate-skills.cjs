#!/usr/bin/env node
/**
 * Migrate commands/, phases/, and agents/subagents/ into Agent Skills layout: skills/<name>/SKILL.md
 *
 * Usage:
 *   node scripts/generate-skills.cjs [--check] [--plugin-root <dir>]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  extractFrontmatter,
  parseSimpleFields,
} = require('./lib/catalog/parse-frontmatter.cjs');
const { listAgentMarkdownFiles } = require('./lib/catalog/walk-subagents.cjs');
const { loadGoldenEvalMap } = require('./lib/skills/golden-eval.cjs');
const { parseMetadataMap } = require('./lib/skills/golden-eval.cjs');

const root = path.resolve(process.argv.includes('--plugin-root')
  ? process.argv[process.argv.indexOf('--plugin-root') + 1]
  : path.join(__dirname, '..'));
const checkOnly = process.argv.includes('--check');

const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/;

/**
 * Agent Skills name: lowercase letters, digits, hyphens only.
 * @param {string} name
 * @returns {string}
 */
function sanitizeSkillName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

/** @typedef {{ kind: string, abs: string, name: string, description: string, sourceRel: string, extra?: Record<string,string> }} Source */

/**
 * @param {string} block
 * @param {Record<string,string>} extra metadata map entries (string values only)
 */
function buildSkillYaml(name, description, extra = {}) {
  const evalStatus = extra.eval_status || 'unevaluated';
  const evalRef = extra.eval_ref || '';
  const meta = {
    tier: extra.tier || 'L2',
    eval_status: evalStatus,
    eval_ref: evalRef,
    version: '1.0.0',
    provenance: 'generate-skills',
    ...Object.fromEntries(
      Object.entries(extra).filter(
        ([k]) => !['eval_status', 'eval_ref', 'tier', 'version', 'provenance'].includes(k)
      )
    ),
  };
  const metaLines = Object.entries(meta)
    .map(([k, v]) => `  ${k}: "${String(v).replace(/"/g, '\\"')}"`)
    .join('\n');
  const descEsc = description.replace(/"/g, '\\"');
  return `---
name: ${name}
description: "${descEsc}"
metadata:
${metaLines}
---
`;
}

/**
 * @param {Source} src
 * @returns {string}
 */
function renderSkill(src, existingMeta = {}, goldenRef = null) {
  const raw = fs.readFileSync(src.abs, 'utf8');
  const ex = extractFrontmatter(raw);
  const body = ex ? ex.body : raw;
  const evalRef = existingMeta.eval_ref || goldenRef || '';
  const evalStatus = existingMeta.eval_status || 'unevaluated';
  const extra = {
    kind: src.kind,
    source: src.sourceRel,
    eval_ref: evalRef,
    eval_status: evalStatus,
    ...(src.extra || {}),
  };
  if (src.name !== src.skillName) {
    extra.agent_name = src.name;
  }
  return `${buildSkillYaml(src.skillName, src.description, extra)}\n${body.trim()}\n`;
}

/** @returns {Source[]} */
function collectSources() {
  /** @type {Source[]} */
  const out = [];

  for (const file of fs.readdirSync(path.join(root, 'commands'))) {
    if (!file.endsWith('.md')) continue;
    const abs = path.join(root, 'commands', file);
    const raw = fs.readFileSync(abs, 'utf8');
    const ex = extractFrontmatter(raw);
    const fm = ex ? parseSimpleFields(ex.block) : {};
    const name = (fm.name || path.basename(file, '.md')).trim();
    const description = (fm.description || `Command skill ${name}.`).trim();
    out.push({
      kind: 'command',
      abs,
      name,
      description,
      sourceRel: path.join('commands', file),
    });
  }

  for (const file of fs.readdirSync(path.join(root, 'phases'))) {
    if (!file.endsWith('.md')) continue;
    const abs = path.join(root, 'phases', file);
    const raw = fs.readFileSync(abs, 'utf8');
    const ex = extractFrontmatter(raw);
    const fm = ex ? parseSimpleFields(ex.block) : {};
    const name = path.basename(file, '.md');
    const description =
      (fm.description || `Pipeline phase skill for state \`${name}\`. Use when current_state is ${name}.`).trim();
    out.push({
      kind: 'phase',
      abs,
      name,
      description,
      sourceRel: path.join('phases', file),
    });
  }

  for (const abs of listAgentMarkdownFiles(path.join(root, 'agents', 'subagents'))) {
    const raw = fs.readFileSync(abs, 'utf8');
    const ex = extractFrontmatter(raw);
    if (!ex) continue;
    const fm = parseSimpleFields(ex.block);
    const name = String(fm.name || path.basename(abs, '.md')).trim();
    const description = String(fm.description || '').trim();
    const rel = path.relative(root, abs);
    out.push({
      kind: 'subagent',
      abs,
      name,
      description,
      sourceRel: rel,
      extra: {
        model: fm.model || 'balanced',
        tools: fm.tools || '',
      },
    });
  }

  return out;
}

function main() {
  const sources = collectSources();
  const names = new Set();
  const errors = [];

  for (const src of sources) {
    src.skillName = sanitizeSkillName(src.name);
    if (!SKILL_NAME_RE.test(src.skillName)) {
      errors.push(`${src.sourceRel}: invalid skill name "${src.skillName}" from "${src.name}"`);
    }
    if (names.has(src.skillName)) {
      errors.push(`duplicate skill name "${src.skillName}" (${src.sourceRel})`);
    }
    names.add(src.skillName);
    if (!src.description) {
      errors.push(`${src.sourceRel}: missing description`);
    }
  }

  if (errors.length) {
    console.error('generate-skills: FAILED\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }

  let written = 0;
  let drift = 0;
  const goldenMap = loadGoldenEvalMap(root);
  for (const src of sources) {
    const skillDir = path.join(root, 'skills', src.skillName);
    const skillPath = path.join(skillDir, 'SKILL.md');
    let existingMeta = {};
    if (fs.existsSync(skillPath)) {
      const prev = fs.readFileSync(skillPath, 'utf8');
      const exPrev = extractFrontmatter(prev);
      if (exPrev) existingMeta = parseMetadataMap(exPrev.block);
    }
    const goldenRef = goldenMap[src.skillName] || goldenMap[src.name] || null;
    const content = renderSkill(src, existingMeta, goldenRef);
    if (checkOnly) {
      if (!fs.existsSync(skillPath)) {
        drift++;
        continue;
      }
      const existing = fs.readFileSync(skillPath, 'utf8');
      if (existing !== content) drift++;
      continue;
    }
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillPath, content);
    written++;
  }

  if (checkOnly) {
    if (drift) {
      console.error(`generate-skills --check: ${drift} skill(s) missing or out of date`);
      process.exit(1);
    }
    console.log(`generate-skills --check: OK (${sources.length} skills)`);
    return;
  }
  console.log(`generate-skills: wrote ${written} skills under skills/`);
}

main();
