#!/usr/bin/env node
/**
 * Compare agents/subagents bodies to pinned upstream shingle fingerprints.
 *
 * Usage:
 *   node scripts/provenance-check.cjs              # report (exit 0)
 *   node scripts/provenance-check.cjs --enforce    # fail if any score >= threshold
 *   node scripts/provenance-check.cjs --json
 *
 * Env:
 *   AGENTIC_SWE_PROVENANCE_THRESHOLD  default 0.5
 *   AGENTIC_SWE_SUBAGENTS_DIR         override catalog root
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { extractFrontmatter, parseProvenance } = require('./lib/catalog/parse-frontmatter.cjs');
const { listAgentMarkdownFiles } = require('./lib/catalog/walk-subagents.cjs');
const {
  DEFAULT_SHINGLE_SIZE,
  bodyShingleHashes,
  unpackHashes,
  jaccard,
} = require('./lib/provenance/shingles.cjs');

const root = path.join(__dirname, '..');
const enforce = process.argv.includes('--enforce');
const asJson = process.argv.includes('--json');
const threshold = Number(process.env.AGENTIC_SWE_PROVENANCE_THRESHOLD || 0.5);
const subagentsDir = path.resolve(
  process.env.AGENTIC_SWE_SUBAGENTS_DIR || path.join(root, 'agents', 'subagents')
);
const fpPath = path.join(root, 'config', 'upstream-fingerprints.json');

function loadFingerprints() {
  if (!fs.existsSync(fpPath)) {
    console.error(`provenance-check: missing ${path.relative(root, fpPath)}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(fpPath, 'utf8'));
}

function main() {
  const fp = loadFingerprints();
  const shingleSize = fp.shingle_size || DEFAULT_SHINGLE_SIZE;
  const files = listAgentMarkdownFiles(subagentsDir);

  /** @type {{ name: string, rel: string, score: number | null, origin: string, matched: boolean }[]} */
  const rows = [];
  let maxScore = 0;
  let over = 0;
  let compared = 0;

  for (const abs of files) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    const name = path.basename(abs, '.md');
    const raw = fs.readFileSync(abs, 'utf8');
    const ex = extractFrontmatter(raw);
    const body = ex ? ex.body : raw;
    const prov = ex ? parseProvenance(ex.block) : {};
    const origin = String(prov.origin || 'unknown');
    const upstream = fp.agents[name];
    if (!upstream) {
      rows.push({ name, rel, score: null, origin, matched: false });
      continue;
    }
    const localHashes = bodyShingleHashes(body, { shingleSize });
    const upSet = unpackHashes(upstream.shingles_b64);
    const score = jaccard(localHashes, upSet);
    compared++;
    if (score > maxScore) maxScore = score;
    const matched = score >= threshold;
    if (matched) over++;
    rows.push({ name, rel, score, origin, matched });
  }

  rows.sort((a, b) => (b.score || 0) - (a.score || 0));

  const summary = {
    upstream_repo: fp.upstream_repo,
    upstream_commit: fp.upstream_commit,
    threshold,
    enforce,
    agents_scanned: files.length,
    compared,
    over_threshold: over,
    max_score: Number(maxScore.toFixed(4)),
    fingerprint_agents: fp.agent_count,
  };

  if (asJson) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
  } else {
    console.log('provenance-check: upstream fingerprint comparison');
    console.log(`  repo=${summary.upstream_repo} commit=${String(summary.upstream_commit).slice(0, 12)}`);
    console.log(
      `  scanned=${summary.agents_scanned} compared=${summary.compared} over_threshold(${threshold})=${summary.over_threshold} max_score=${summary.max_score}`
    );
    const top = rows.filter((r) => r.score != null).slice(0, 15);
    if (top.length) {
      console.log('  top scores:');
      for (const r of top) {
        const flag = r.matched ? ' FAIL' : '';
        console.log(`    ${r.score.toFixed(3)}${flag}  ${r.name}  (${r.origin})`);
      }
    }
    const noFp = rows.filter((r) => r.score == null);
    if (noFp.length) {
      console.log(`  no upstream fingerprint (${noFp.length}): ${noFp.map((r) => r.name).join(', ')}`);
    }
  }

  if (enforce && over > 0) {
    console.error(
      `provenance-check: ENFORCE failed — ${over} agent(s) score >= ${threshold} (max ${summary.max_score})`
    );
    process.exit(1);
  }
  if (!asJson) {
    console.log(
      enforce
        ? 'provenance-check: OK (enforce, no matches over threshold)'
        : 'provenance-check: report-only (use --enforce to fail CI)'
    );
  }
}

main();
