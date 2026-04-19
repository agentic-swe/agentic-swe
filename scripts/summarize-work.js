#!/usr/bin/env node
/**
 * Read-only summary of pipeline work items under `.worklogs/*/state.json`.
 * Does not run the Hypervisor — for dashboards and human triage.
 *
 * Usage:
 *   node scripts/summarize-work.js [--project-root <abs>]   # text table
 *   node scripts/summarize-work.js [--project-root <abs>] --json    # JSON array on stdout
 *
 * Env: AGENTIC_SWE_PROJECT_ROOT (same semantics as work-engine record-cost / doctor).
 */
'use strict';

const fs = require('fs');
const path = require('path');

function resolveProjectRoot() {
  if (process.env.AGENTIC_SWE_PROJECT_ROOT) {
    return path.resolve(process.env.AGENTIC_SWE_PROJECT_ROOT);
  }
  const idx = process.argv.indexOf('--project-root');
  if (idx >= 0 && process.argv[idx + 1]) {
    return path.resolve(process.argv[idx + 1]);
  }
  return process.cwd();
}

const WORK_ROOT = path.join(resolveProjectRoot(), '.worklogs');
const asJson = process.argv.includes('--json');

function readWorkSummaries() {
  if (!fs.existsSync(WORK_ROOT)) {
    return [];
  }
  const out = [];
  for (const id of fs.readdirSync(WORK_ROOT)) {
    const dir = path.join(WORK_ROOT, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    const statePath = path.join(dir, 'state.json');
    if (!fs.existsSync(statePath)) continue;
    let state;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      out.push({
        work_id: id,
        error: 'invalid state.json',
      });
      continue;
    }
    const pipeline = state.pipeline || {};
    const budget = state.budget || {};
    out.push({
      work_id: state.work_id || id,
      current_state: state.current_state,
      track: pipeline.track != null ? pipeline.track : '(unset)',
      task: state.task ? String(state.task).slice(0, 80) : '',
      budget_remaining: budget.budget_remaining,
      cost_used: budget.cost_used,
      updated_at: state.updated_at,
    });
  }
  out.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return out;
}

function main() {
  const rows = readWorkSummaries();
  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) {
    console.log(`No work items under ${WORK_ROOT}`);
    return;
  }
  console.log('work_id\tstate\ttrack\tbudget\tcost_usd\ttask');
  for (const r of rows) {
    if (r.error) {
      console.log(`${r.work_id}\tERROR\t-\t-\t-\t${r.error}`);
      continue;
    }
    console.log(
      `${r.work_id}\t${r.current_state}\t${r.track}\t${r.budget_remaining ?? '?'}\t${r.cost_used ?? '?'}\t${r.task}`
    );
  }
}

main();
