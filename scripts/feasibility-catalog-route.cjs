#!/usr/bin/env node
'use strict';

/**
 * Append or replace ## Catalog Routing in a work item's feasibility.md
 * using lexical (or auto) catalog-route hits.
 *
 * Usage:
 *   node scripts/feasibility-catalog-route.cjs --work-dir .worklogs/<id> --query "..." [--k 5] [--json]
 */

const fs = require('node:fs');
const path = require('node:path');
const { listAgentMarkdownFiles } = require('./lib/catalog/walk-subagents.cjs');
const { rankLexical, agentSearchBlob } = require('./lib/catalog/lexical-rank.cjs');
const {
  formatCatalogRoutingSection,
  upsertCatalogRoutingSection,
} = require('./lib/feasibility/catalog-signals.cjs');

const packRoot = path.join(__dirname, '..');

function parseArgs(argv) {
  const out = { workDir: null, query: '', k: 5, json: false, write: true };
  const args = argv.slice(2);
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--work-dir' && args[i + 1]) {
      out.workDir = path.resolve(args[++i]);
      continue;
    }
    if (args[i] === '--query' && args[i + 1]) {
      out.query = String(args[++i]);
      continue;
    }
    if (args[i] === '--k' && args[i + 1]) {
      out.k = Math.max(1, parseInt(args[++i], 10) || 5);
      continue;
    }
    if (args[i] === '--json') {
      out.json = true;
      continue;
    }
    if (args[i] === '--stdout-only') {
      out.write = false;
      continue;
    }
    if (!args[i].startsWith('-')) pos.push(args[i]);
  }
  if (!out.query && pos.length) out.query = pos.join(' ');
  return out;
}

function loadAgents() {
  const subagentsDir = path.join(packRoot, 'agents', 'subagents');
  const files = listAgentMarkdownFiles(subagentsDir);
  const agents = [];
  for (const abs of files) {
    const cat = path.basename(path.dirname(abs));
    const base = path.basename(abs, '.md');
    const id = `${cat}/${base}`;
    const raw = fs.readFileSync(abs, 'utf8');
    const blob = agentSearchBlob(raw, id);
    agents.push({ id: blob.id, text: blob.text });
  }
  return agents;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.workDir || !args.query) {
    console.error(
      'Usage: node scripts/feasibility-catalog-route.cjs --work-dir .worklogs/<id> --query "..." [--k 5] [--json] [--stdout-only]'
    );
    process.exit(2);
  }

  const feasibilityPath = path.join(args.workDir, 'feasibility.md');
  if (args.write && !fs.existsSync(feasibilityPath)) {
    console.error(`feasibility.md not found at ${feasibilityPath}`);
    process.exit(1);
  }

  const agents = loadAgents();
  const ranked = rankLexical(args.query, agents).slice(0, args.k);
  const hits = ranked.map((row) => ({ id: row.id, score: row.score }));
  const section = formatCatalogRoutingSection({
    query: args.query,
    mode: 'lexical',
    hits,
  });

  let written = null;
  if (args.write) {
    const prev = fs.readFileSync(feasibilityPath, 'utf8');
    const next = upsertCatalogRoutingSection(prev, section);
    fs.writeFileSync(feasibilityPath, next);
    written = feasibilityPath;
  }

  if (args.json) {
    console.log(JSON.stringify({ ok: true, hits, written, section }, null, 2));
  } else {
    process.stdout.write(section);
    if (written) process.stderr.write(`updated ${written}\n`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}

module.exports = { parseArgs, loadAgents };
