#!/usr/bin/env node
/**
 * Session chunks (paths + isolated node --test) → evaluated session-mine →
 * implementation skip_llm vs L3. Not a full-session USD claim.
 *
 * Usage:
 *   node scripts/bench/run-session-mine-descent.cjs [--out bench/results/session-mine-descent-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { ingestTranscripts } = require('../lib/memory/session-ingest.cjs');
const { mineSessionProcedures } = require('../lib/descent/mine-session-procedures.cjs');
const { runDescentOnImplementationEntry } = require('../lib/descent/implementation-descent.cjs');
const { loadTierTokenEstimates } = require('../lib/descent/ladder.cjs');

const TARGET = 0.02;

async function main() {
  const pluginRoot = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `session-mine-descent-${date}.json`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-mine-desc-'));
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'test'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src', 'hit.js'), 'module.exports = 1;\n');
  fs.writeFileSync(
    path.join(tmp, 'test', 'hit.test.js'),
    `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
test('hit', () => assert.equal(require('../src/hit.js'), 1));
`
  );
  const transcript = path.join(tmp, 'session.jsonl');
  fs.writeFileSync(
    transcript,
    `${JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: 'Edited `src/hit.js` and ran node --test test/hit.test.js',
      },
    })}\n`
  );

  await ingestTranscripts({
    projectRoot: tmp,
    pluginRoot,
    transcriptPaths: [transcript],
    maxFiles: 4,
  });
  const mined = await mineSessionProcedures({
    projectRoot: tmp,
    pluginRoot,
    storeRoot: tmp,
    limit: 8,
  });

  const workDir = path.join(tmp, '.worklogs', 'w-follow');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(
    path.join(workDir, 'state.json'),
    JSON.stringify({
      work_id: 'w-follow',
      current_state: 'test-strategy',
      metrics: { verify_command: 'npm test' },
      budget: {},
    })
  );
  fs.writeFileSync(
    path.join(workDir, 'design.md'),
    '# Design\n\n- `src/hit.js`\n\n```bash\nnpm test\n```\n'
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
    ok: mined.procedures >= 1 && r.skip_llm_exploration === true && r.overlap_source === 'session-mine',
    measurement_contract:
      'Session-chunk isolated node --test overlapping a new design’s declared files. Not a full SWE session USD claim.',
    mined: { procedures: mined.procedures, mined: mined.mined },
    skip_llm_exploration: r.skip_llm_exploration === true,
    overlap_source: r.overlap_source,
    tier: r.tier,
    delivered_tokens: delivered,
    cold_l3_tokens: cold,
    multiplier,
    target_multiplier: TARGET,
    target_met:
      r.skip_llm_exploration === true &&
      r.overlap_source === 'session-mine' &&
      multiplier <= TARGET,
  };

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`session-mine-descent: wrote ${outPath}`);
  console.log(
    `  overlap=${payload.overlap_source} skip_llm=${payload.skip_llm_exploration} ${r.tier} ${delivered}/${cold} (${(multiplier * 100).toFixed(3)}%) target_met=${payload.target_met}`
  );
  process.exit(payload.ok && payload.target_met ? 0 : 1);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
