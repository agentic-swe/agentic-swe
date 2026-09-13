#!/usr/bin/env node
/**
 * List sibling repos that could become independent fleet consumers (read-only scan).
 *
 * Usage:
 *   node scripts/fleet-candidate-repos.cjs [--parent dir] [--plugin-root dir] [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { isKnownMaintainerDogfoodConsumer } = require('./lib/fleet/dogfood-consumers.cjs');
const { buildSubmissionReadiness } = require('./lib/fleet/submission-readiness.cjs');
const { readFleetStatusSnapshot } = require('./lib/fleet/fleet-status-snapshot.cjs');
const { evaluateFleetScaleGate } = require('./lib/fleet/fleet-scale-gate.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--parent') out.parentDir = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
  }
  return out;
}

function countOrganicWorklogs(repoRoot) {
  const dir = path.join(repoRoot, '.worklogs');
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    if (fs.existsSync(path.join(dir, name, 'state.json'))) n++;
  }
  return n;
}

function scanCandidateRepos(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot || getDefaultPluginRoot());
  const parentDir = path.resolve(opts.parentDir || path.join(pluginRoot, '..', '..'));
  const fleetScale = evaluateFleetScaleGate(pluginRoot);
  const candidates = [];

  if (!fs.existsSync(parentDir)) {
    return { ok: false, error: `parent dir not found: ${parentDir}`, candidates: [] };
  }

  for (const name of fs.readdirSync(parentDir)) {
    const repoRoot = path.join(parentDir, name);
    if (!fs.statSync(repoRoot).isDirectory()) continue;
    if (path.resolve(repoRoot) === pluginRoot) continue;
    if (!fs.existsSync(path.join(repoRoot, '.git'))) continue;

    const dogfood = isKnownMaintainerDogfoodConsumer(pluginRoot, repoRoot);
    const worklogCount = countOrganicWorklogs(repoRoot);
    const readiness = buildSubmissionReadiness({ projectRoot: repoRoot, pluginRoot });
    const fleetStatus = readFleetStatusSnapshot(repoRoot);

    candidates.push({
      repo_root: repoRoot,
      name,
      maintainer_dogfood_archived: dogfood,
      eligible_for_independent: !dogfood,
      worklog_dirs: worklogCount,
      organic_live: readiness.organic_live,
      fleet_submission_ready: readiness.fleet_submission_ready,
      blockers: readiness.blockers,
      fleet_status_updated_at: fleetStatus?.updated_at || null,
    });
  }

  candidates.sort((a, b) => {
    if (a.eligible_for_independent !== b.eligible_for_independent) {
      return a.eligible_for_independent ? -1 : 1;
    }
    return (b.organic_live || 0) - (a.organic_live || 0);
  });

  return {
    ok: true,
    goal_complete: false,
    parent_dir: parentDir,
    plugin_root: pluginRoot,
    fleet_scale: fleetScale,
    eligible_count: candidates.filter((c) => c.eligible_for_independent).length,
    ready_count: candidates.filter((c) => c.eligible_for_independent && c.fleet_submission_ready).length,
    candidates,
    next_maintainer_actions: [
      'Pick ≥3 eligible repos with real organic /work (not maintainer_dogfood siblings)',
      'npm run fleet-independent-bootstrap -- --consumer-root <repo> --merge-policy --write-workflow',
      'npm run fleet-share-kit -- --out-dir bench/results/fleet-share-kit',
    ],
  };
}

function main() {
  const args = parseArgs(process.argv);
  const payload = scanCandidateRepos(args);
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else if (!payload.ok) {
    console.error(payload.error);
    process.exit(1);
  } else {
    console.log('fleet-candidate-repos: goal_complete=false');
    console.log(
      `  fleet_scale: ${payload.fleet_scale.distinct_independent_consumers}/${payload.fleet_scale.target} independent`
    );
    console.log(`  eligible git repos: ${payload.eligible_count}, submission-ready: ${payload.ready_count}`);
    for (const c of payload.candidates.slice(0, 12)) {
      const tag = c.maintainer_dogfood_archived
        ? 'dogfood'
        : c.fleet_submission_ready
          ? 'ready'
          : 'eligible';
      console.log(
        `  [${tag}] ${c.name} worklogs=${c.worklog_dirs} organic_live=${c.organic_live ?? 0}`
      );
    }
  }
}

module.exports = { scanCandidateRepos };

if (require.main === module) main();
