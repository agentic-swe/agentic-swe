#!/usr/bin/env node
/**
 * Implementation-entry skip_llm: fingerprint L0 hit vs L3 estimate.
 *
 * Measures engine skip of frontier work when a scoped procedure already exists.
 * Not a claim that a new feature is implemented at 1–2% tokens.
 *
 * Usage:
 *   node scripts/bench/run-implementation-entry.cjs [--out bench/results/implementation-entry-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { buildFingerprint } = require('../lib/descent/fingerprint.cjs');
const { promoteOrDemote } = require('../lib/descent/promotion.cjs');
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
      : path.join(pluginRoot, 'bench', 'results', `implementation-entry-${date}.json`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-entry-bench-'));
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'src', 'hit.js'), 'module.exports = 1;\n');
  const verify = 'node -e "process.exit(0)"';
  const fp = buildFingerprint({ files: ['src/hit.js'], verifyCommand: verify });
  promoteOrDemote({
    projectRoot: tmp,
    fingerprint: fp,
    procedure: {
      actions: [{ type: 'READ_FILE', path: 'src/hit.js' }],
      verify: [{ type: 'RUN', command: verify }],
    },
    evalPassed: true,
    humanApproved: true,
  });

  const workDir = path.join(tmp, '.worklogs', 'w-bench');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(
    path.join(workDir, 'state.json'),
    JSON.stringify(
      {
        work_id: 'w-bench',
        current_state: 'test-strategy',
        metrics: { verify_command: verify },
        budget: {},
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(workDir, 'design.md'),
    '# Design\n\n- `src/hit.js`\n\n```bash\nnode -e "process.exit(0)"\n```\n'
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
    ok: r.skip_llm_exploration === true && r.ok === true,
    measurement_contract:
      'Fingerprint-scoped L0/L1 at implementation entry vs L3. Does not implement a new feature without a matching procedure.',
    skip_llm_exploration: r.skip_llm_exploration === true,
    tier: r.tier,
    delivered_tokens: delivered,
    cold_l3_tokens: cold,
    multiplier,
    target_multiplier: TARGET,
    target_met: r.skip_llm_exploration === true && multiplier <= TARGET,
  };

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`implementation-entry: wrote ${outPath}`);
  console.log(
    `  skip_llm=${payload.skip_llm_exploration} ${r.tier} ${delivered}/${cold} (${(multiplier * 100).toFixed(3)}%) target_met=${payload.target_met}`
  );
  process.exit(payload.ok && payload.target_met ? 0 : 1);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
