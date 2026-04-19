#!/usr/bin/env node
/**
 * Writes two sample work items under .worklogs/ for local dashboard demos.
 * Output paths are gitignored (.worklogs/). Safe to re-run with --force.
 *
 *   node scripts/seed-dashboard-demo.cjs [--cwd <repoRoot>] [--force]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const pluginRoot = path.join(__dirname, '..');
const templatePath = path.join(pluginRoot, 'templates', 'state.json');

function parseArgs(argv) {
  let cwd = process.cwd();
  let force = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--cwd' && argv[i + 1]) cwd = path.resolve(argv[++i]);
    else if (argv[i] === '--force') force = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: node scripts/seed-dashboard-demo.cjs [--cwd <dir>] [--force]');
      process.exit(0);
    }
  }
  return { cwd, force };
}

function cloneTemplate() {
  return JSON.parse(fs.readFileSync(templatePath, 'utf8'));
}

function writeWorkItem(cwd, dirId, state, { force }) {
  const dir = path.join(cwd, '.worklogs', dirId);
  if (fs.existsSync(dir)) {
    if (!force) {
      console.error(`Refusing to overwrite existing ${dir} (use --force)`);
      process.exit(2);
    }
  } else {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n', 'utf8');
  console.log('Wrote', path.join('.worklogs', dirId, 'state.json'));
}

function main() {
  const { cwd, force } = parseArgs(process.argv);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 36 * 60 * 60 * 1000);

  const active = cloneTemplate();
  active.work_id = '_demo-active';
  active.task = 'Demo: active pipeline item (seed-dashboard-demo)';
  active.current_state = 'implementation';
  active.created_at = yesterday.toISOString();
  active.updated_at = now.toISOString();
  active.timeout_at = new Date(now.getTime() + 48 * 60 * 60 * 1000).toISOString();
  active.pipeline = active.pipeline || {};
  active.pipeline.track = 'standard';
  active.budget = {
    iteration_budget: 12,
    budget_remaining: 8,
    cost_budget_usd: 6,
    cost_used: 1.842,
    usage_totals: {
      input_tokens: 12000,
      output_tokens: 3400,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 0,
    },
  };
  active.counters = {
    lean_iter: 1,
    design_iter: 1,
    code_iter: 2,
    panel_runs: 1,
    merge_iter: 0,
    approval_iter: 0,
    self_review_iter: 0,
    test_adequacy_iter: 0,
    subagent_spawns: 4,
  };
  active.history = [
    { at: yesterday.toISOString(), from: 'initialized', to: 'feasibility', actor: 'seed' },
    {
      at: new Date(yesterday.getTime() + 3600000).toISOString(),
      from: 'feasibility',
      to: 'lean-track-check',
      actor: 'seed',
    },
    {
      at: new Date(yesterday.getTime() + 7200000).toISOString(),
      from: 'lean-track-check',
      to: 'design',
      actor: 'seed',
    },
    {
      at: new Date(yesterday.getTime() + 10800000).toISOString(),
      from: 'design',
      to: 'implementation',
      actor: 'seed',
    },
  ];

  const done = cloneTemplate();
  done.work_id = '_demo-done';
  done.task = 'Demo: completed item (seed-dashboard-demo)';
  done.current_state = 'completed';
  done.created_at = new Date(now.getTime() - 72 * 60 * 60 * 1000).toISOString();
  done.updated_at = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  done.timeout_at = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  done.pipeline = done.pipeline || {};
  done.pipeline.track = 'lean';
  done.budget = {
    iteration_budget: 10,
    budget_remaining: 0,
    cost_budget_usd: 2.5,
    cost_used: 2.1,
    usage_totals: {
      input_tokens: 9000,
      output_tokens: 2100,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  };
  done.counters = {
    lean_iter: 2,
    design_iter: 0,
    code_iter: 3,
    panel_runs: 0,
    merge_iter: 1,
    approval_iter: 1,
    self_review_iter: 0,
    test_adequacy_iter: 0,
    subagent_spawns: 6,
  };
  done.history = [
    { at: done.created_at, from: 'initialized', to: 'feasibility', actor: 'seed' },
    {
      at: new Date(new Date(done.created_at).getTime() + 600000).toISOString(),
      from: 'feasibility',
      to: 'completed',
      actor: 'seed',
    },
  ];

  writeWorkItem(cwd, '_demo-active', active, { force });
  writeWorkItem(cwd, '_demo-done', done, { force });
  console.log('Done. Run: npm run swe-dashboard -- --cwd', cwd);
}

main();
