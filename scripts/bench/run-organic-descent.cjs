#!/usr/bin/env node
/**
 * Organic /work capture → implementation-entry skip_llm vs L3.
 *
 * Prior completed work records declared files + isolated node --test.
 * A new item listing the same files with verify `npm test` still skip_llm via overlap.
 *
 * Usage:
 *   node scripts/bench/run-organic-descent.cjs [--out bench/results/organic-descent-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { captureOrganicWorklogs } = require('../lib/descent/capture-organic-worklogs.cjs');
const { runDescentOnImplementationEntry } = require('../lib/descent/implementation-descent.cjs');
const { loadTierTokenEstimates } = require('../lib/descent/ladder.cjs');

const TARGET = 0.02;

function writePriorOrganic(projectRoot) {
  const workDir = path.join(projectRoot, '.worklogs', 'feat-retry');
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'test'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'src', 'retry.js'), 'module.exports = 1;\n');
  fs.writeFileSync(
    path.join(projectRoot, 'test', 'retry.test.js'),
    `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
test('retry', () => assert.equal(require('../src/retry.js'), 1));
`
  );
  fs.writeFileSync(
    path.join(workDir, 'state.json'),
    JSON.stringify({
      work_id: 'feat-retry',
      current_state: 'completed',
      metrics: { verify_command: 'npm test', tests_passed: true },
      history: [
        { actor: 'composer', from: 'implementation', to: 'validation' },
        { actor: 'composer', from: 'validation', to: 'pr-creation' },
        { actor: 'user', from: 'pr-creation', to: 'completed' },
      ],
    })
  );
  fs.writeFileSync(
    path.join(workDir, 'implementation.md'),
    '# Implementation\n\n1. `src/retry.js`\n2. `test/retry.test.js`\n\n```bash\nnpm test\n```\n'
  );
  fs.writeFileSync(
    path.join(workDir, 'validation-results.md'),
    '# Validation\n\nclassification: `approved`\n\n```bash\nnpm test\n```\n'
  );
}

async function main() {
  const pluginRoot = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `organic-descent-${date}.json`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'org-descent-'));
  writePriorOrganic(tmp);
  const captured = captureOrganicWorklogs({
    projectRoot: tmp,
    pluginRoot,
    includeFixtures: false,
    preferIsolatedTest: true,
  });

  const workDir = path.join(tmp, '.worklogs', 'w-followup');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(
    path.join(workDir, 'state.json'),
    JSON.stringify({
      work_id: 'w-followup',
      current_state: 'test-strategy',
      metrics: { verify_command: 'npm test' },
      budget: {},
    })
  );
  fs.writeFileSync(
    path.join(workDir, 'design.md'),
    '# Design\n\n- `src/retry.js`\n\n```bash\nnpm test\n```\n'
  );

  const r = await runDescentOnImplementationEntry({
    workDir,
    pluginRoot,
    projectRoot: tmp,
  });
  const estimates = loadTierTokenEstimates(pluginRoot);
  const delivered = r.ok ? Number(r.delivered_tokens) : estimates.L3;
  const cold = estimates.L3;
  const multiplier = cold > 0 ? delivered / cold : 1;

  const payload = {
    generated_at: new Date().toISOString(),
    ok:
      captured.captured >= 1 &&
      r.skip_llm_exploration === true &&
      r.overlap_source === 'organic-worklog',
    measurement_contract:
      'Prior organic /work isolated node --test overlapping a new design’s declared files; design verify may be npm test. Not a full SWE session USD claim.',
    captured: { captured: captured.captured, verify: captured.captures?.[0]?.verifyCommand },
    skip_llm_exploration: r.skip_llm_exploration === true,
    overlap_source: r.overlap_source,
    tier: r.tier,
    delivered_tokens: delivered,
    cold_l3_tokens: cold,
    multiplier,
    target_multiplier: TARGET,
    target_met:
      r.skip_llm_exploration === true &&
      r.overlap_source === 'organic-worklog' &&
      multiplier <= TARGET,
  };

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`organic-descent: wrote ${outPath}`);
  console.log(
    `  overlap=${payload.overlap_source} skip_llm=${payload.skip_llm_exploration} ${r.tier} ${delivered}/${cold} (${(multiplier * 100).toFixed(3)}%) target_met=${payload.target_met}`
  );
  process.exit(payload.ok && payload.target_met ? 0 : 1);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
