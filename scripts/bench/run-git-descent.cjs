#!/usr/bin/env node
/**
 * Git history → evaluated isolated test → implementation-entry skip_llm vs L3.
 *
 * Design may list a different verify (e.g. npm test); overlap matching uses
 * co-changed source files from git-mined procedures. Not a full-session USD claim.
 *
 * Usage:
 *   node scripts/bench/run-git-descent.cjs [--out bench/results/git-descent-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { mineGitProcedures } = require('../lib/descent/mine-git-procedures.cjs');
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
      : path.join(pluginRoot, 'bench', 'results', `git-descent-${date}.json`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-descent-'));
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
  spawnSync('git', ['init'], { cwd: tmp, encoding: 'utf8' });
  spawnSync('git', ['add', '.'], { cwd: tmp, encoding: 'utf8' });
  const commit = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'add hit'],
    { cwd: tmp, encoding: 'utf8' }
  );
  if (commit.status !== 0) {
    console.error(commit.stderr);
    process.exit(1);
  }

  const mined = mineGitProcedures({ projectRoot: tmp, pluginRoot, maxCommits: 5, limit: 4 });
  const workDir = path.join(tmp, '.worklogs', 'w-git');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(
    path.join(workDir, 'state.json'),
    JSON.stringify({
      work_id: 'w-git',
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
    ok: mined.procedures >= 1 && r.skip_llm_exploration === true && r.overlap_source === 'git-history',
    measurement_contract:
      'Git-mined isolated node --test overlapping design-declared files; design verify may differ (npm test). Not a full SWE session claim.',
    mined,
    skip_llm_exploration: r.skip_llm_exploration === true,
    overlap_source: r.overlap_source,
    tier: r.tier,
    delivered_tokens: delivered,
    cold_l3_tokens: cold,
    multiplier,
    target_multiplier: TARGET,
    target_met:
      r.skip_llm_exploration === true &&
      r.overlap_source === 'git-history' &&
      multiplier <= TARGET,
  };

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`git-descent: wrote ${outPath}`);
  console.log(
    `  overlap=${payload.overlap_source} skip_llm=${payload.skip_llm_exploration} ${r.tier} ${delivered}/${cold} (${(multiplier * 100).toFixed(3)}%) target_met=${payload.target_met}`
  );
  process.exit(payload.ok && payload.target_met ? 0 : 1);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
