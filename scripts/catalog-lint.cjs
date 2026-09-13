#!/usr/bin/env node
/**
 * Lint subagent catalog: frontmatter, unique names, model enum, purpose overlap,
 * invocation cues in description, tools present, name matches filename.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  extractFrontmatter,
  parseSimpleFields,
  ALLOWED_MODELS,
  LEGACY_MODELS,
  normalizeModelTier,
} = require('./lib/catalog/parse-frontmatter.cjs');
const { listAgentMarkdownFiles } = require('./lib/catalog/walk-subagents.cjs');

const root = path.join(__dirname, '..');
const subagentsDir = path.resolve(process.env.AGENTIC_SWE_SUBAGENTS_DIR || path.join(root, 'agents', 'subagents'));

/** Pairwise Jaccard on description tokens (length >= 4) — flags similar purpose without identical text. */
const PURPOSE_OVERLAP_MIN_JACCARD = Number(
  process.env.AGENTIC_SWE_CATALOG_OVERLAP_JACCARD || 0.55
);

const INVOCATION_CUE =
  /use\s+when|use\s+this\s+agent|use\s+for|invoke|when you need|when you want/i;

function tokenizeForOverlap(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 4);
}

function jaccardTokens(a, b) {
  const A = new Set(tokenizeForOverlap(a));
  const B = new Set(tokenizeForOverlap(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) {
    if (B.has(t)) inter++;
  }
  const uni = A.size + B.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

function lint() {
  const files = listAgentMarkdownFiles(subagentsDir);
  if (files.length === 0) {
    console.error(`catalog-lint: no agent .md files under ${subagentsDir}`);
    process.exit(1);
  }

  const errors = [];
  const nameToFile = new Map();
  const descToFiles = new Map();
  /** @type {{ rel: string, desc: string }[]} */
  const descRecords = [];

  for (const abs of files) {
    const rel = path.relative(root, abs);
    const baseName = path.basename(abs, '.md');
    const raw = fs.readFileSync(abs, 'utf8');
    if (raw.length === 0) {
      errors.push(`${rel}: empty file`);
      continue;
    }
    const ex = extractFrontmatter(raw);
    if (!ex) {
      errors.push(`${rel}: missing or invalid YAML frontmatter (expected --- delimiters)`);
      continue;
    }
    const fm = parseSimpleFields(ex.block);
    const name = fm.name && String(fm.name).trim();
    if (!name) {
      errors.push(`${rel}: missing or empty name:`);
    } else {
      if (name !== baseName) {
        errors.push(`${rel}: name "${name}" must match filename "${baseName}"`);
      }
      const prev = nameToFile.get(name);
      if (prev) errors.push(`${rel}: duplicate agent name "${name}" (also in ${prev})`);
      else nameToFile.set(name, rel);
    }
    const desc = fm.description != null ? String(fm.description).trim() : '';
    if (!desc) {
      errors.push(`${rel}: missing or empty description`);
    } else {
      if (!INVOCATION_CUE.test(desc)) {
        errors.push(
          `${rel}: description should state when to use the agent (e.g. "Use when…", "Use for…", "Invoke when…")`
        );
      }
      const key = desc.toLowerCase();
      if (!descToFiles.has(key)) descToFiles.set(key, []);
      descToFiles.get(key).push(rel);
      descRecords.push({ rel, desc });
    }
    const model = fm.model && String(fm.model).trim();
    if (!model) {
      errors.push(`${rel}: missing model:`);
    } else {
      const tier = normalizeModelTier(model);
      if (!ALLOWED_MODELS.has(tier)) {
        errors.push(`${rel}: model must be fast|balanced|heavy|frontier; got "${model}"`);
      }
    }
    if (!Object.prototype.hasOwnProperty.call(fm, 'tools')) {
      errors.push(`${rel}: missing tools: (expected tool list for I/O expectations)`);
    } else {
      const t = String(fm.tools || '').trim();
      if (!t) errors.push(`${rel}: tools: present but empty`);
    }
  }

  for (const rels of descToFiles.values()) {
    if (rels.length > 1) {
      errors.push(`duplicate description text (${rels.length} files): ${rels.join(', ')}`);
    }
  }

  for (let i = 0; i < descRecords.length; i++) {
    for (let j = i + 1; j < descRecords.length; j++) {
      const a = descRecords[i];
      const b = descRecords[j];
      if (a.desc === b.desc) continue;
      const jac = jaccardTokens(a.desc, b.desc);
      if (jac >= PURPOSE_OVERLAP_MIN_JACCARD) {
        errors.push(
          `high purpose overlap (Jaccard ${jac.toFixed(2)} >= ${PURPOSE_OVERLAP_MIN_JACCARD}): ${a.rel} vs ${b.rel}`
        );
      }
    }
  }

  if (errors.length) {
    console.error('catalog-lint: FAILED\n' + errors.map((e) => `  - ${e}`).join('\n'));
    process.exit(1);
  }
  console.log(`catalog-lint: OK (${files.length} agents under ${path.relative(root, subagentsDir) || '.'})`);
}

lint();
