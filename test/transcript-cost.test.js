'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('os');
const path = require('node:path');
const { usdForUsage } = require('../scripts/lib/work-engine/pricing.cjs');
const { scanTranscriptIncremental, syncCostFromTranscript } = require('../scripts/lib/work-engine/transcript-cost.cjs');

const fixture = path.join(__dirname, 'fixtures', 'transcript-cost-sample.jsonl');

describe('transcript cost / API spend', () => {
  it('usdForUsage matches Sonnet-class rates for fixture line', () => {
    const u = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 };
    const usd = usdForUsage(u, 'claude-sonnet-4-20250514');
    assert.ok(Math.abs(usd - 0.0111) < 1e-9, `got ${usd}`);
  });

  it('scanTranscriptIncremental sums assistant usage once', () => {
    const r = scanTranscriptIncremental(fixture, 0);
    assert.ok(r.newUsd > 0);
    assert.strictEqual(r.usageDelta.input_tokens, 1000);
    assert.strictEqual(r.usageDelta.output_tokens, 500);
    assert.strictEqual(r.usageDelta.cache_read_input_tokens, 2000);
    assert.strictEqual(r.usageDelta.cache_creation_input_tokens, 0);
    assert.strictEqual(r.endLine, fs.readFileSync(fixture, 'utf8').split(/\r?\n/).length);
    const r2 = scanTranscriptIncremental(fixture, r.endLine);
    assert.strictEqual(r2.newUsd, 0);
    assert.strictEqual(r2.usageDelta.input_tokens, 0);
  });

  it('syncCostFromTranscript updates state.json cost_used', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-cost-'));
    const workDir = path.join(tmp, 'w1');
    fs.mkdirSync(workDir, { recursive: true });
    const state = {
      schema_version: 2,
      work_id: 'w1',
      task: 't',
      current_state: 'feasibility',
      created_at: 'x',
      updated_at: 'x',
      timeout_at: 'x',
      owner: 'x',
      mode: 'full',
      resume: {},
      budget: { iteration_budget: 10, budget_remaining: 9, cost_budget_usd: 100, cost_used: 0 },
      counters: {},
      ambiguity: { detected: false, notes: [], resolved: false },
      approvals: { pr_approved: false, changes_requested: false },
      metrics: { tests_passed: false },
      risk: { level: 'unknown', score: null, top_items: [] },
      artifacts: {},
      validation: {},
      git: {},
      pipeline: { track: 'lean' },
      convergence: {},
      history: [],
    };
    fs.copyFileSync(fixture, path.join(tmp, 'transcript.jsonl'));
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(state, null, 2));
    const r = syncCostFromTranscript({
      workDir,
      transcriptPath: path.join(tmp, 'transcript.jsonl'),
      dryRun: false,
    });
    assert.strictEqual(r.ok, true);
    const next = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
    assert.ok(next.budget.cost_used > 0);
    assert.ok(next.budget.cost_ledger && next.budget.cost_ledger.line_cursor > 0);
    assert.deepStrictEqual(next.budget.usage_totals, {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 0,
    });
    const r2 = syncCostFromTranscript({
      workDir,
      transcriptPath: path.join(tmp, 'transcript.jsonl'),
      dryRun: false,
    });
    assert.strictEqual(r2.delta_usd, 0);
  });

  it('discoverActiveWorkDir picks non-completed newest', () => {
    const { discoverActiveWorkDir } = require('../scripts/lib/work-engine/discover-workdir.cjs');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-disc-'));
    fs.mkdirSync(path.join(tmp, '.worklogs', 'old'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.worklogs', 'new'), { recursive: true });
    const minimal = (id, state) => ({ work_id: id, current_state: state, budget: {} });
    fs.writeFileSync(
      path.join(tmp, '.worklogs', 'old', 'state.json'),
      JSON.stringify(minimal('old', 'completed'), null, 2)
    );
    fs.writeFileSync(
      path.join(tmp, '.worklogs', 'new', 'state.json'),
      JSON.stringify(minimal('new', 'feasibility'), null, 2)
    );
    const picked = discoverActiveWorkDir(tmp);
    assert.strictEqual(path.basename(picked), 'new');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('discoverActiveWorkDir tie-breaks by work id name when mtime ties', () => {
    const { discoverActiveWorkDir, discoverActiveWorkDirWithMeta } = require('../scripts/lib/work-engine/discover-workdir.cjs');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-disc-tie-'));
    fs.mkdirSync(path.join(tmp, '.worklogs', 'zebra'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.worklogs', 'alpha'), { recursive: true });
    const minimal = (id, state) => ({ work_id: id, current_state: state, budget: {} });
    const t = new Date('2020-01-01T00:00:00Z');
    const pZ = path.join(tmp, '.worklogs', 'zebra', 'state.json');
    const pA = path.join(tmp, '.worklogs', 'alpha', 'state.json');
    fs.writeFileSync(pZ, JSON.stringify(minimal('zebra', 'feasibility'), null, 2));
    fs.writeFileSync(pA, JSON.stringify(minimal('alpha', 'feasibility'), null, 2));
    fs.utimesSync(pZ, t, t);
    fs.utimesSync(pA, t, t);
    const picked = discoverActiveWorkDir(tmp);
    assert.strictEqual(path.basename(picked), 'alpha');
    const meta = discoverActiveWorkDirWithMeta(tmp);
    assert.strictEqual(meta.tieAtMax, true);
    assert.ok(meta.warning && meta.warning.includes('alpha'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
