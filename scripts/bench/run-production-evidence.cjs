#!/usr/bin/env node
/**
 * Production evidence bench: work-engine E2E with descent tier recording + capture.
 *
 * Creates work items for delivered holdout tasks, runs descent-try (records tier_totals),
 * transitions validation → pr-creation (descent-capture), aggregates production multiplier.
 *
 * Usage:
 *   node scripts/bench/run-production-evidence.cjs [--out bench/results/production-evidence-<date>.json] [--persist-fixtures]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { getDefaultPluginRoot, applyTransition } = require('../lib/work-engine/engine.cjs');
const { runTaskAcceptance } = require('../lib/bench/run-task.cjs');
const { isHoldoutTask } = require('../lib/descent/holdout-capture.cjs');
const { accumulateDeliveredHoldout } = require('../lib/descent/holdout-capture.cjs');
const {
  aggregateProductionTierTotals,
  productionPortfolioMultiplier,
  FIXTURE_WORKLOGS,
} = require('../lib/bench/production-tier-totals.cjs');

const TARGET_MULTIPLIER = 0.02;
const MIN_WORK_ITEMS = 3;

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function copyDir(src, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function baseState(workId, verifyCommand) {
  const tpl = JSON.parse(
    fs.readFileSync(path.join(getDefaultPluginRoot(), 'templates', 'state.json'), 'utf8')
  );
  const now = new Date().toISOString();
  tpl.work_id = workId;
  tpl.task = `bench holdout ${workId}`;
  tpl.current_state = 'validation';
  tpl.created_at = now;
  tpl.updated_at = now;
  tpl.timeout_at = new Date(Date.now() + 86400000).toISOString();
  tpl.budget.budget_remaining = 10;
  tpl.metrics.verify_command = verifyCommand;
  tpl.metrics.tests_passed = true;
  tpl.validation.structural_passed = true;
  tpl.validation.quality_passed = true;
  return tpl;
}

function setupWorkItem(worklogsRoot, taskId, verifyCommand) {
  const workId = `bench-${taskId}`;
  const workDir = path.join(worklogsRoot, workId);
  fs.mkdirSync(workDir, { recursive: true });
  writeJson(path.join(workDir, 'state.json'), baseState(workId, verifyCommand));
  fs.writeFileSync(
    path.join(workDir, 'validation-results.md'),
    `# Validation\n\nclassification: \`approved\`\n\n\`\`\`bash\n${verifyCommand}\n\`\`\`\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(workDir, 'implementation.md'),
    `# Implementation\n\nHoldout bench task \`${taskId}\`.\n\n\`\`\`bash\n${verifyCommand}\n\`\`\`\n`,
    'utf8'
  );
  return workDir;
}

function runDescentTry(pluginRoot, workDir, verifyCommand, fileKey) {
  const extra = [];
  if (fileKey) extra.push('--files', fileKey);
  const r = spawnSync(
    process.execPath,
    [
      path.join(pluginRoot, 'scripts/descent-try.cjs'),
      '--work-dir',
      workDir,
      '--verify',
      verifyCommand,
      '--plugin-root',
      pluginRoot,
      '--project-root',
      pluginRoot,
      ...extra,
      '--json',
    ],
    { encoding: 'utf8', cwd: pluginRoot }
  );
  let parsed = null;
  try {
    parsed = JSON.parse(r.stdout.trim());
  } catch {
    /* ignore */
  }
  return { status: r.status, parsed, stderr: r.stderr };
}

function deliveredHoldoutTasks(pluginRoot) {
  const corpusRoot = path.join(pluginRoot, 'bench', 'corpus');
  const tasks = [];
  for (const name of fs.readdirSync(corpusRoot)) {
    if (!isHoldoutTask(name)) continue;
    const taskDir = path.join(corpusRoot, name);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    const acceptance = runTaskAcceptance(taskDir);
    if (!acceptance.ok) continue;
    const scoring = JSON.parse(fs.readFileSync(path.join(taskDir, 'scoring.json'), 'utf8'));
    tasks.push({ id: name, verify: scoring.task_pass?.command || 'npm test' });
  }
  return tasks;
}

function main() {
  const pluginRoot = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `production-evidence-${date}.json`);
  const persistFixtures = process.argv.includes('--persist-fixtures');

  accumulateDeliveredHoldout({ pluginRoot, projectRoot: pluginRoot, purge: true });

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-evidence-'));
  const worklogsRoot = path.join(tmpRoot, '.worklogs');
  fs.mkdirSync(worklogsRoot, { recursive: true });

  const holdoutTasks = deliveredHoldoutTasks(pluginRoot);
  const runs = [];

  for (const task of holdoutTasks) {
    const workDir = setupWorkItem(worklogsRoot, task.id, task.verify);
    const descent = runDescentTry(pluginRoot, workDir, task.verify, task.id);
    const transition = applyTransition({
      workDir,
      pluginRoot,
      from: 'validation',
      to: 'pr-creation',
      actor: 'production-evidence-bench',
      reason: 'holdout validation approved',
    });
    runs.push({
      task: task.id,
      verify: task.verify,
      descent_ok: descent.parsed?.ok === true,
      descent_tier: descent.parsed?.tier,
      transition_ok: transition.ok === true,
      delivered_tokens: descent.parsed?.delivered_tokens,
    });
  }

  const production = aggregateProductionTierTotals(tmpRoot, { includeFixtures: false });
  const phase1Path = path.join(pluginRoot, 'bench/results/phase1-2026-08-29.json');
  const phase1 = fs.existsSync(phase1Path)
    ? JSON.parse(fs.readFileSync(phase1Path, 'utf8'))
    : { estimated_tokens_before: 7700, estimated_tokens_after: 1750 };
  const portfolio = productionPortfolioMultiplier(production, {
    policyCold: phase1.estimated_tokens_before || 7700,
    policyWarm: phase1.estimated_tokens_after || 1750,
  });

  const verified =
    runs.length >= MIN_WORK_ITEMS &&
    runs.every((r) => r.descent_ok && r.transition_ok) &&
    production.work_items >= MIN_WORK_ITEMS &&
    portfolio.portfolio_multiplier <= TARGET_MULTIPLIER;

  if (persistFixtures) {
    const fixtureDest = path.join(pluginRoot, FIXTURE_WORKLOGS);
    copyDir(worklogsRoot, fixtureDest);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    ok: true,
    measurement_contract:
      'Work-engine E2E: descent-try with holdout task file keys + plugin project-root (corpus cwd) then validation→pr-creation',
    runs,
    production_tier_totals: production,
    portfolio,
    verified,
    target_multiplier: TARGET_MULTIPLIER,
    honesty: verified
      ? 'Production E2E path verified on holdout tasks; persist fixtures with --persist-fixtures for CI aggregation'
      : 'Production E2E evidence incomplete — check descent hits and tier_totals recording',
    fixture_path: persistFixtures ? FIXTURE_WORKLOGS : null,
  };

  writeJson(outPath, payload);
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log(`production-evidence: wrote ${outPath}`);
  console.log(`  work items: ${production.work_items}, verified: ${verified}`);
  console.log(
    `  production portfolio: ${(portfolio.portfolio_multiplier * 100).toFixed(2)}% of cold`
  );
  process.exit(verified ? 0 : 1);
}

main();
