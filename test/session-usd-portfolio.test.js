'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  aggregateOrganicSessionUsd,
  inferReplayTier,
} = require('../scripts/lib/bench/session-usd-portfolio.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('session USD portfolio', () => {
  it('infers replay tier from descent metrics', () => {
    const estimates = { L0: 0, L1: 1500, L2: 8000, L3: 200000 };
    assert.equal(inferReplayTier({ metrics: { descent_tier: 'L1' } }, estimates), 'L1');
    assert.equal(inferReplayTier({ budget: {} }, estimates), 'L3');
  });

  it('computes warm replay USD multiplier for organic /work with billed session', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-usd-'));
    const wid = 'feat-auth';
    const d = path.join(tmp, '.worklogs', wid);
    fs.mkdirSync(d, { recursive: true });
    const usage = {
      input_tokens: 303,
      output_tokens: 182030,
      cache_read_input_tokens: 39749583,
      cache_creation_input_tokens: 1426693,
    };
    fs.writeFileSync(
      path.join(d, 'state.json'),
      JSON.stringify({
        current_state: 'completed',
        metrics: { descent_tier: 'L0' },
        budget: { cost_used: 20.006333, usage_totals: usage },
        history: [
          { actor: 'hypervisor', from: 'initialized', to: 'feasibility' },
          { actor: 'hypervisor', from: 'validation', to: 'pr-creation' },
          { actor: 'user', from: 'approval-wait', to: 'completed' },
        ],
      })
    );

    const r = aggregateOrganicSessionUsd(tmp, pluginRoot);
    assert.equal(r.summary.billed_sessions, 1);
    assert.ok(r.summary.session_usd_multiplier < 0.02);
    assert.match(r.measurement_contract, /verify-replay/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('Cursor session-stop hook', () => {
  it('records transcript cost before session capture', () => {
    const src = fs.readFileSync(path.join(pluginRoot, 'hooks/session-stop'), 'utf8');
    const costIdx = src.indexOf('hook-record-cost.cjs');
    const capIdx = src.indexOf('session-capture.cjs');
    assert.ok(costIdx > 0 && capIdx > costIdx, 'hook-record-cost must run before session-capture');
  });

  it('syncs cost_used from hook stdin transcript_path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stop-cost-'));
    const workDir = path.join(tmp, '.worklogs', 'w-cost');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({
        work_id: 'w-cost',
        current_state: 'implementation',
        budget: { cost_used: 0, cost_budget_usd: 50 },
        history: [],
      })
    );
    const tx = path.join(tmp, 'session.jsonl');
    fs.writeFileSync(
      tx,
      `${JSON.stringify({
        role: 'assistant',
        model: 'claude-sonnet-4-20250514',
        usage: { input_tokens: 1000, output_tokens: 500 },
      })}\n`
    );
    const r = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts/lib/work-engine/hook-record-cost.cjs')],
      {
        encoding: 'utf8',
        cwd: tmp,
        input: JSON.stringify({ cwd: tmp, transcript_path: tx }),
        env: { ...process.env, AGENTIC_SWE_WORK_DIR: workDir },
      }
    );
    assert.equal(r.status, 0, r.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
    assert.ok(state.budget.cost_used > 0);
    assert.ok(state.budget.usage_totals.input_tokens >= 1000);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
