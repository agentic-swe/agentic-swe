#!/usr/bin/env node
/**
 * Migrate model: sonnet|opus|haiku → balanced|heavy|fast in agent frontmatter.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { listAgentMarkdownFiles } = require('./lib/catalog/walk-subagents.cjs');

const MAP = { sonnet: 'balanced', opus: 'heavy', haiku: 'fast' };
const root = path.join(__dirname, '..');
const checkOnly = process.argv.includes('--check');

let changed = 0;
for (const abs of listAgentMarkdownFiles(path.join(root, 'agents', 'subagents'))) {
  let raw = fs.readFileSync(abs, 'utf8');
  let next = raw;
  for (const [from, to] of Object.entries(MAP)) {
    next = next.replace(new RegExp(`^model:\\s*${from}\\s*$`, 'm'), `model: ${to}`);
  }
  if (next !== raw) {
    changed++;
    if (!checkOnly) fs.writeFileSync(abs, next);
  }
}

// panel + core agents
for (const rel of ['agents/developer-agent.md', 'agents/git-operations-agent.md', 'agents/pr-manager-agent.md', 'agents/goal-verifier-agent.md']) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) continue;
  let raw = fs.readFileSync(abs, 'utf8');
  let next = raw;
  for (const [from, to] of Object.entries(MAP)) {
    next = next.replace(new RegExp(`^model:\\s*${from}\\s*$`, 'm'), `model: ${to}`);
  }
  if (next !== raw) {
    changed++;
    if (!checkOnly) fs.writeFileSync(abs, next);
  }
}

if (checkOnly && changed) {
  console.error(`migrate-model-tiers --check: ${changed} file(s) need migration`);
  process.exit(1);
}
console.log(checkOnly ? `migrate-model-tiers --check: OK` : `migrate-model-tiers: updated ${changed} files`);
