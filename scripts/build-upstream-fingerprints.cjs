#!/usr/bin/env node
/**
 * Build config/upstream-fingerprints.json from a local checkout of
 * VoltAgent/awesome-claude-code-subagents. Does NOT commit upstream text —
 * only shingle hash fingerprints.
 *
 * Usage:
 *   node scripts/build-upstream-fingerprints.cjs --upstream /path/to/clone [--out config/upstream-fingerprints.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { extractFrontmatter } = require('./lib/catalog/parse-frontmatter.cjs');
const {
  DEFAULT_SHINGLE_SIZE,
  bodyShingleHashes,
  packHashes,
  bodyContentHash,
} = require('./lib/provenance/shingles.cjs');

const root = path.join(__dirname, '..');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function main() {
  const upstreamRoot = path.resolve(argValue('--upstream') || '');
  if (!upstreamRoot || !fs.existsSync(upstreamRoot)) {
    console.error('Usage: node scripts/build-upstream-fingerprints.cjs --upstream <clone-dir>');
    process.exit(2);
  }
  const categories = path.join(upstreamRoot, 'categories');
  if (!fs.existsSync(categories)) {
    console.error(`No categories/ under ${upstreamRoot}`);
    process.exit(1);
  }

  const git = spawnSync('git', ['-C', upstreamRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (git.status !== 0) {
    console.error('upstream must be a git checkout');
    process.exit(1);
  }
  const commit = git.stdout.trim();

  /** @type {Record<string, { body_sha256: string, shingles_b64: string, shingle_count: number }>} */
  const agents = {};
  for (const cat of fs.readdirSync(categories)) {
    const catDir = path.join(categories, cat);
    if (!fs.statSync(catDir).isDirectory()) continue;
    for (const file of fs.readdirSync(catDir)) {
      if (!file.endsWith('.md') || file === 'README.md') continue;
      const abs = path.join(catDir, file);
      const raw = fs.readFileSync(abs, 'utf8');
      const ex = extractFrontmatter(raw);
      const body = ex ? ex.body : raw;
      const name = path.basename(file, '.md');
      const hashes = bodyShingleHashes(body, { shingleSize: DEFAULT_SHINGLE_SIZE });
      agents[name] = {
        body_sha256: bodyContentHash(body),
        shingles_b64: packHashes(hashes),
        shingle_count: hashes.length,
      };
    }
  }

  const outPath = path.resolve(
    argValue('--out') || path.join(root, 'config', 'upstream-fingerprints.json')
  );
  const payload = {
    schema_version: 1,
    upstream_repo: 'VoltAgent/awesome-claude-code-subagents',
    upstream_commit: commit,
    license: 'MIT',
    copyright: 'Copyright (c) 2025 VoltAgent',
    shingle_size: DEFAULT_SHINGLE_SIZE,
    generated_at: new Date().toISOString(),
    agent_count: Object.keys(agents).length,
    agents,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
  console.log(
    `Wrote ${outPath} (${payload.agent_count} agents, commit ${commit.slice(0, 7)}, shingle_size=${DEFAULT_SHINGLE_SIZE})`
  );
}

main();
