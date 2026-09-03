#!/usr/bin/env node
/**
 * Mine THIS pack’s git history into an isolated store, then skip_llm via file overlap.
 * Does not write the pack’s committed .agentic-swe/procedures.json.
 *
 * Usage:
 *   node scripts/bench/run-git-pack-descent.cjs [--out bench/results/git-pack-descent-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { mineGitProcedures } = require('../lib/descent/mine-git-procedures.cjs');
const { loadStore } = require('../lib/descent/promotion.cjs');
const { procedureReadPaths } = require('../lib/descent/overlap-procedure.cjs');
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
      : path.join(pluginRoot, 'bench', 'results', `git-pack-descent-${date}.json`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-pack-descent-'));
  const mined = mineGitProcedures({
    projectRoot: pluginRoot,
    pluginRoot,
    storeRoot: tmp,
    maxCommits: 20,
    limit: 2,
  });
  const store = loadStore(tmp);
  const rec = (store.procedures || []).find(
    (p) => p.procedure?._meta?.source === 'git-history' && p.eval_status === 'evaluated'
  );

  let r = { skip_llm_exploration: false, overlap_source: null, tier: 'L3', ok: false };
  let declared = null;
  if (rec) {
    const paths = procedureReadPaths(rec);
    declared = paths.find((p) => !/^(test|tests)\//.test(p)) || paths[0];
    const workDir = path.join(tmp, '.worklogs', 'w-pack-git');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({
        work_id: 'w-pack-git',
        current_state: 'test-strategy',
        metrics: { verify_command: 'npm test' },
        budget: {},
      })
    );
    fs.writeFileSync(
      path.join(workDir, 'design.md'),
      `# Design\n\n- \`${declared}\`\n\n\`\`\`bash\nnpm test\n\`\`\`\n`
    );
    r = await runDescentOnImplementationEntry({
      workDir,
      pluginRoot,
      projectRoot: pluginRoot,
      procedureStoreRoot: tmp,
    });
  }

  const estimates = loadTierTokenEstimates(pluginRoot);
  const delivered = r.ok ? Number(r.delivered_tokens) : estimates.L3;
  const cold = estimates.L3;
  const multiplier = cold > 0 ? delivered / cold : 1;

  const payload = {
    generated_at: new Date().toISOString(),
    ok: mined.procedures >= 1 && r.skip_llm_exploration === true && r.overlap_source === 'git-history',
    measurement_contract:
      'Real pack git history mined into an isolated store; design verify is npm test; skip_llm uses overlapping isolated node --test. Does not mutate pack procedures.json. Not fleet /work.',
    mined: { procedures: mined.procedures, mined: mined.mined },
    declared_file: declared,
    skip_llm_exploration: r.skip_llm_exploration === true,
    overlap_source: r.overlap_source || null,
    tier: r.tier,
    delivered_tokens: delivered,
    cold_l3_tokens: cold,
    multiplier,
    target_multiplier: TARGET,
    target_met:
      r.skip_llm_exploration === true && r.overlap_source === 'git-history' && multiplier <= TARGET,
  };

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`git-pack-descent: wrote ${outPath}`);
  console.log(
    `  declared=${declared || '(none)'} overlap=${payload.overlap_source} skip_llm=${payload.skip_llm_exploration} ${r.tier} ${delivered}/${cold} (${(multiplier * 100).toFixed(3)}%) target_met=${payload.target_met}`
  );
  process.exit(payload.ok && payload.target_met ? 0 : 1);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
