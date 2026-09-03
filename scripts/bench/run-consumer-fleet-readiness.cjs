#!/usr/bin/env node
/**
 * Consumer-repo fleet submission readiness: isolated tmp repo with 3 organic /work
 * items (tier_totals) proves buildSubmissionReadiness can pass outside the pack.
 *
 * Not independent fleet traffic — mechanism evidence only. goal_complete stays false.
 *
 * Usage:
 *   node scripts/bench/run-consumer-fleet-readiness.cjs [--out bench/results/consumer-fleet-readiness-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { emptyTierTotals } = require('../lib/bench/tier-totals.cjs');
const { captureOrganicWorklogs } = require('../lib/descent/capture-organic-worklogs.cjs');
const { runFleetOnboard } = require('../fleet-onboard.cjs');
const { buildSubmissionReadiness } = require('../lib/fleet/submission-readiness.cjs');
const { checkMuscleMemoryReadiness } = require('../lib/work-engine/muscle-memory-doctor.cjs');

const TARGET = 0.02;

function writeOrganicWorkItem(projectRoot, workId, verifyCommand) {
  const workDir = path.join(projectRoot, '.worklogs', workId);
  fs.mkdirSync(workDir, { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(workDir, 'state.json'),
    JSON.stringify(
      {
        schema_version: 2,
        work_id: workId,
        task: `fleet readiness ${workId}`,
        current_state: 'completed',
        created_at: now,
        updated_at: now,
        budget: {
          iteration_budget: 10,
          budget_remaining: 8,
          tier_totals: emptyTierTotals(),
        },
        metrics: {
          verify_command: verifyCommand,
          tests_passed: true,
          descent_tier: 'L0',
          descent_hit: true,
          descent_recorded_at: now,
        },
        history: [
          { at: now, actor: 'engineer', from: 'implementation', to: 'validation' },
          { at: now, actor: 'engineer', from: 'validation', to: 'pr-creation' },
          { at: now, actor: 'user', from: 'pr-creation', to: 'completed' },
        ],
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(workDir, 'implementation.md'),
    `# Implementation\n\n\`\`\`bash\n${verifyCommand}\n\`\`\`\n`
  );
  fs.writeFileSync(
    path.join(workDir, 'validation-results.md'),
    `# Validation\n\nclassification: \`approved\`\n\n\`\`\`bash\n${verifyCommand}\n\`\`\`\n`
  );
}

async function main() {
  const pluginRoot = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `consumer-fleet-readiness-${date}.json`);

  const consumerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'consumer-fleet-'));
  spawnSync('git', ['init'], { cwd: consumerRoot, stdio: 'pipe' });

  if (path.resolve(consumerRoot) === path.resolve(pluginRoot)) {
    throw new Error('consumer repo must not be the plugin pack root');
  }

  fs.mkdirSync(path.join(consumerRoot, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(consumerRoot, 'package.json'),
    JSON.stringify({ name: 'consumer-fleet-fixture', scripts: { test: 'node --test test/ok.test.js' } })
  );
  fs.writeFileSync(
    path.join(consumerRoot, 'test', 'ok.test.js'),
    `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
test('ok', () => assert.equal(1, 1));
`
  );

  const verify = 'npm test';
  for (const id of ['feat-fleet-a', 'feat-fleet-b', 'feat-fleet-c']) {
    writeOrganicWorkItem(consumerRoot, id, verify);
  }

  const captured = captureOrganicWorklogs({
    projectRoot: consumerRoot,
    pluginRoot,
    includeFixtures: false,
    preferIsolatedTest: true,
  });

  const onboard = await runFleetOnboard({
    projectRoot: consumerRoot,
    pluginRoot,
    skipSessions: true,
    evolve: false,
  });

  const doctor = checkMuscleMemoryReadiness({ projectRoot: consumerRoot, pluginRoot });
  const readiness = buildSubmissionReadiness({
    projectRoot: consumerRoot,
    pluginRoot,
    muscleMemoryOk: doctor.ok,
  });

  const payload = {
    generated_at: new Date().toISOString(),
    ok:
      captured.captured >= 1 &&
      onboard.ok === true &&
      onboard.consumer_mode === true &&
      readiness.organic_live >= 3 &&
      readiness.portfolio_target_met === true &&
      readiness.fleet_submission_ready === true,
    measurement_contract:
      'Isolated tmp consumer repo with 3 synthetic organic /work items. Proves fleet submission gate mechanics — not independent team fleet traffic. goal_complete stays false.',
    consumer_root: consumerRoot,
    plugin_root: pluginRoot,
    isolated_from_pack: true,
    organic_live: readiness.organic_live,
    tier_totals_work_items: readiness.tier_totals_work_items,
    portfolio_multiplier: readiness.portfolio_multiplier,
    target_multiplier: TARGET,
    target_met: readiness.portfolio_target_met && readiness.fleet_submission_ready,
    fleet_submission_ready: readiness.fleet_submission_ready,
    blockers: readiness.blockers,
    captured: captured.captured,
    fleet_onboard_ok: onboard.ok,
  };

  fs.rmSync(consumerRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`consumer-fleet-readiness: wrote ${outPath}`);
  console.log(
    `  organic_live=${payload.organic_live} submission_ready=${payload.fleet_submission_ready} mult=${(payload.portfolio_multiplier * 100).toFixed(3)}% target_met=${payload.target_met}`
  );
  process.exit(payload.ok && payload.target_met ? 0 : 1);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
