#!/usr/bin/env node
/**
 * Top-k subagent router: lexical (default) or semantic (embedding similarity) when index exists.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveEmbeddingRuntime } = require('./lib/memory/embeddings-backend.cjs');
const { listAgentMarkdownFiles } = require('./lib/catalog/walk-subagents.cjs');
const { rankLexical, agentSearchBlob } = require('./lib/catalog/lexical-rank.cjs');
const { rankByEmbedding } = require('./lib/catalog/embed-rank.cjs');
const { loadMergedCatalogConfig, resolveCatalogIndexPath } = require('./lib/catalog/catalog-config.cjs');
const { discoverActiveWorkDir } = require('./lib/work-engine/discover-workdir.cjs');
const { adviseSubagentChoice, catalogJevSuffix } = require('./lib/jev/rerank.cjs');

const root = path.join(__dirname, '..');
const subagentsDirDefault = path.join(root, 'agents', 'subagents');

function parseArgs(argv) {
  const args = argv.slice(2);
  let k = 5;
  let asJson = false;
  let mode = 'auto';
  let projectRoot = process.cwd();
  let pluginRoot = root;
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--k' && args[i + 1]) {
      k = Math.max(1, parseInt(args[++i], 10) || 5);
      continue;
    }
    if (args[i] === '--json') {
      asJson = true;
      continue;
    }
    if (args[i] === '--mode' && args[i + 1]) {
      mode = String(args[++i]).toLowerCase();
      continue;
    }
    if (args[i] === '--project-root' && args[i + 1]) {
      projectRoot = path.resolve(args[++i]);
      continue;
    }
    if (args[i] === '--plugin-root' && args[i + 1]) {
      pluginRoot = path.resolve(args[++i]);
      continue;
    }
    pos.push(args[i]);
  }
  return { query: pos.join(' ').trim(), k, json: asJson, mode, projectRoot, pluginRoot };
}

async function main() {
  const { query, k, json, mode, projectRoot, pluginRoot } = parseArgs(process.argv);
  if (!query) {
    console.error(
      'Usage: catalog-route <query...> [--k N] [--json] [--mode auto|lexical|semantic] [--project-root DIR] [--plugin-root DIR]'
    );
    process.exit(2);
  }

  const subagentsDir = path.resolve(process.env.AGENTIC_SWE_SUBAGENTS_DIR || subagentsDirDefault);
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

  const merged = loadMergedCatalogConfig(pluginRoot, projectRoot);
  const indexPath = resolveCatalogIndexPath(merged, projectRoot);
  const rt = resolveEmbeddingRuntime(merged);
  let ranked;
  let used = 'lexical';

  const wantSemantic = mode === 'semantic' || mode === 'auto';
  const canSemantic = rt && fs.existsSync(indexPath);

  if (wantSemantic && canSemantic) {
    try {
      ranked = await rankByEmbedding(query, indexPath, rt);
      used = 'semantic';
    } catch (e) {
      if (mode === 'semantic') {
        console.error(`catalog-route: semantic routing failed: ${e.message}`);
        process.exit(1);
      }
      ranked = rankLexical(query, agents);
    }
  } else {
    if (mode === 'semantic' && !rt) {
      console.error('catalog-route: semantic mode requires embedding backend (catalog embeddings.enabled + provider)');
      process.exit(1);
    }
    if (mode === 'semantic' && !fs.existsSync(indexPath)) {
      console.error(
        `catalog-route: semantic mode requires index at ${indexPath} (run: node scripts/catalog-index.cjs)`
      );
      process.exit(1);
    }
    ranked = rankLexical(query, agents);
  }

  const top = ranked.slice(0, k);
  const byId = new Map(agents.map((agent) => [agent.id, agent.text]));
  let jev = {
    skipped: null,
    applied: false,
    order: top.map((row) => row.id),
    fallback: 'retrieval',
  };
  if (top.length) {
    let workDir = '';
    try {
      workDir = process.env.AGENTIC_SWE_WORK_DIR
        ? path.resolve(process.env.AGENTIC_SWE_WORK_DIR)
        : discoverActiveWorkDir(projectRoot) || '';
    } catch {
      workDir = '';
    }
    try {
      const advised = await adviseSubagentChoice({
        pluginRoot,
        projectRoot,
        query,
        candidates: top.map((row) => ({ id: row.id, text: byId.get(row.id) || row.id })),
        workDir,
        env: process.env,
      });
      jev = advised.jev;
    } catch {
      jev = {
        skipped: 'http_error',
        applied: false,
        order: top.map((row) => row.id),
        fallback: 'retrieval',
      };
    }
  }
  const out = { query, k, mode: used, results: top, jev };
  if (json) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`query: ${query}  [${used}]\n`);
    for (const r of top) {
      console.log(`${r.score.toFixed(used === 'semantic' ? 4 : 0)}\t${r.id}`);
    }
    for (const line of catalogJevSuffix(jev)) console.log(line);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
