#!/usr/bin/env node
/**
 * Seed memory graph with durable conventions from CHANGELOG, docs, and git history.
 * Complements cold-start-warm for day-one muscle memory.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { openOrCreateDatabase, persistDatabase, closeDatabase } = require('./lib/memory/graph-store.cjs');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('./lib/memory/config.cjs');
const { upsertTypedNodes } = require('./lib/memory/session-capture.cjs');
const { buildFingerprint } = require('./lib/descent/fingerprint.cjs');
const { promoteOrDemote } = require('./lib/descent/promotion.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
  }
  return out;
}

function extractChangelogConventions(changelogPath) {
  if (!fs.existsSync(changelogPath)) return [];
  const body = fs.readFileSync(changelogPath, 'utf8');
  const nodes = [];
  for (const line of body.split('\n')) {
    if (/^-\s+\*\*/.test(line.trim())) {
      nodes.push({
        id: `convention:changelog:${Buffer.from(line).toString('base64url').slice(0, 16)}`,
        kind: 'convention',
        label: line.trim().slice(0, 120),
        body: line.trim(),
      });
    }
  }
  return nodes.slice(0, 40);
}

function extractGitConventions(projectRoot) {
  try {
    const log = execSync('git log -30 --pretty=format:%s', { cwd: projectRoot, encoding: 'utf8' });
    return log
      .split('\n')
      .filter((l) => /version|sync|docs|catalog|memory|bench/i.test(l))
      .slice(0, 15)
      .map((subject, i) => ({
        id: `pattern:git:${i}`,
        kind: 'pattern',
        label: subject.slice(0, 120),
        body: subject,
      }));
  } catch {
    return [];
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = args.projectRoot || process.cwd();
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);

  const nodes = [
    ...extractChangelogConventions(path.join(pluginRoot, 'CHANGELOG.md')),
    ...extractGitConventions(projectRoot),
  ];

  const { db } = await openOrCreateDatabase(sqlitePath);
  try {
    upsertTypedNodes(db, nodes);
    persistDatabase(db, sqlitePath);
  } finally {
    closeDatabase(db);
  }

  const fp = buildFingerprint({
    files: ['package.json', '.version-bump.json', 'README.md', 'CHANGELOG.md'],
    verifyCommand: 'bash scripts/bump-version.sh check',
  });
  promoteOrDemote({
    projectRoot,
    fingerprint: fp,
    procedure: {
      preconditions: [{ type: 'READ_FILE', path: '.version-bump.json' }],
      actions: [{ type: 'RUN', command: 'bash scripts/bump-version.sh check' }],
      verify: [{ type: 'RUN', command: 'bash scripts/bump-version.sh check' }],
    },
    evalPassed: true,
    humanApproved: true,
  });

  const out = { ok: true, nodes: nodes.length, l0_fingerprint: fp.slice(0, 16) };
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else console.log(`seed-memory-corpus: ${nodes.length} nodes, L0 version-sync procedure seeded`);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
