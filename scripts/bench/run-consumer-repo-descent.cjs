#!/usr/bin/env node
/**
 * Isolated consumer-repo muscle memory: plugin from pack, project in tmp.
 *
 * Proves organic capture + evolve-cycle + implementation skip_llm work when
 * projectRoot !== pluginRoot. Not fleet traffic; not pack-root live .worklogs.
 *
 * Usage:
 *   node scripts/bench/run-consumer-repo-descent.cjs [--out bench/results/consumer-repo-descent-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { captureOrganicWorklogs } = require('../lib/descent/capture-organic-worklogs.cjs');
const { runDescentOnImplementationEntry } = require('../lib/descent/implementation-descent.cjs');
const { loadTierTokenEstimates } = require('../lib/descent/ladder.cjs');
const { promoteOrDemote } = require('../lib/descent/promotion.cjs');
const { buildFingerprint } = require('../lib/descent/fingerprint.cjs');
const { runEvolveCycle } = require('../evolve-cycle.cjs');
const { promoteRitualSkillCandidates } = require('../lib/skills/skill-eval-suggestions.cjs');
const { runFleetOnboard } = require('../fleet-onboard.cjs');
const { sqlitePathForProject } = require('../lib/memory/config.cjs');
const { loadMergedMemoryConfig } = require('../lib/memory/config.cjs');

const TARGET = 0.02;

function writePriorOrganic(projectRoot) {
  const workDir = path.join(projectRoot, '.worklogs', 'feat-widget');
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify({
      name: 'consumer-fixture',
      scripts: {
        test: 'node --test test/widget.test.js',
        'team-verify': 'node --test test/widget.test.js',
      },
    })
  );
  fs.writeFileSync(path.join(projectRoot, 'src', 'widget.js'), 'module.exports = 42;\n');
  fs.writeFileSync(
    path.join(projectRoot, 'test', 'widget.test.js'),
    `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
test('widget', () => assert.equal(require('../src/widget.js'), 42));
`
  );
  fs.writeFileSync(
    path.join(workDir, 'state.json'),
    JSON.stringify({
      work_id: 'feat-widget',
      current_state: 'completed',
      metrics: { verify_command: 'node --test test/widget.test.js', tests_passed: true },
      history: [
        { actor: 'engineer', from: 'implementation', to: 'validation' },
        { actor: 'engineer', from: 'validation', to: 'pr-creation' },
        { actor: 'user', from: 'pr-creation', to: 'completed' },
      ],
    })
  );
  fs.writeFileSync(
    path.join(workDir, 'implementation.md'),
    '# Implementation\n\n1. `src/widget.js`\n2. `test/widget.test.js`\n\n```bash\nnode --test test/widget.test.js\n```\n'
  );
  fs.writeFileSync(
    path.join(workDir, 'validation-results.md'),
    '# Validation\n\nclassification: `approved`\n\n```bash\nnode --test test/widget.test.js\n```\n'
  );
}

async function main() {
  const pluginRoot = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `consumer-repo-descent-${date}.json`);

  const consumerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'consumer-repo-'));
  spawnSync('git', ['init'], { cwd: consumerRoot, stdio: 'pipe' });
  writePriorOrganic(consumerRoot);

  assertConsumerNotPack(consumerRoot, pluginRoot);

  const captured = captureOrganicWorklogs({
    projectRoot: consumerRoot,
    pluginRoot,
    includeFixtures: false,
    preferIsolatedTest: true,
  });

  const fleetOnboard = await runFleetOnboard({
    projectRoot: consumerRoot,
    pluginRoot,
    skipSessions: true,
    evolve: false,
  });

  promoteOrDemote({
    projectRoot: consumerRoot,
    fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: 'npm run team-verify' }),
    procedure: {
      actions: [{ type: 'READ_FILE', path: 'package.json' }],
      verify: [{ type: 'RUN', command: 'npm run team-verify' }],
      _meta: { source: 'organic-worklog' },
    },
    evalPassed: true,
    humanApproved: true,
  });

  const evolve = await runEvolveCycle({
    projectRoot: consumerRoot,
    pluginRoot,
    limit: 8,
    scaffoldRituals: true,
  });
  const teamVerifySkill = path.join(consumerRoot, '.agentic-swe', 'skills', 'team-verify', 'SKILL.md');
  const projectSkillScaffolded = fs.existsSync(teamVerifySkill);
  fs.mkdirSync(path.join(consumerRoot, '.agentic-swe'), { recursive: true });
  fs.writeFileSync(
    path.join(consumerRoot, '.agentic-swe', 'skill-golden-eval.json'),
    JSON.stringify(
      { version: 1, skills: { 'team-verify': 'bench/corpus/oracle-verify-sanity' } },
      null,
      2
    )
  );
  const promoted = promoteRitualSkillCandidates({ projectRoot: consumerRoot, pluginRoot });
  const projectSkillEvaluated =
    projectSkillScaffolded && /eval_status: "evaluated"/.test(fs.readFileSync(teamVerifySkill, 'utf8'));
  const merged = loadMergedMemoryConfig(pluginRoot, consumerRoot);
  const memorySqlite = sqlitePathForProject(merged, consumerRoot);
  const consumerProcedures = path.join(consumerRoot, '.agentic-swe', 'procedures.json');

  const workDir = path.join(consumerRoot, '.worklogs', 'w-consumer-follow');
  fs.mkdirSync(workDir, { recursive: true });
  fs.writeFileSync(
    path.join(workDir, 'state.json'),
    JSON.stringify({
      work_id: 'w-consumer-follow',
      current_state: 'test-strategy',
      metrics: { verify_command: 'npm test' },
      budget: {},
    })
  );
  fs.writeFileSync(
    path.join(workDir, 'design.md'),
    '# Design\n\n- `src/widget.js`\n\n```bash\nnpm test\n```\n'
  );

  const r = await runDescentOnImplementationEntry({
    workDir,
    pluginRoot,
    projectRoot: consumerRoot,
  });

  const followState = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
  const estimates = loadTierTokenEstimates(pluginRoot);
  const delivered = r.ok ? Number(r.delivered_tokens) : estimates.L3;
  const cold = estimates.L3;
  const multiplier = cold > 0 ? delivered / cold : 1;
  const hasTierTotals = Boolean(followState.budget?.tier_totals);

  const payload = {
    generated_at: new Date().toISOString(),
    ok:
      captured.captured >= 1 &&
      fleetOnboard.ok === true &&
      fleetOnboard.consumer_mode === true &&
      evolve.ok === true &&
      projectSkillScaffolded &&
      projectSkillEvaluated &&
      fs.existsSync(memorySqlite) &&
      fs.existsSync(consumerProcedures) &&
      r.skip_llm_exploration === true &&
      r.overlap_source === 'organic-worklog',
    measurement_contract:
      'Isolated git consumer repo (tmp); plugin from pack path. Organic capture + evolve-cycle + skip_llm. Not fleet /work or pack-root live .worklogs.',
    consumer_root: consumerRoot,
    plugin_root: pluginRoot,
    isolated_from_pack: path.resolve(consumerRoot) !== path.resolve(pluginRoot),
    captured: captured.captured,
    fleet_onboard: {
      ok: fleetOnboard.ok,
      consumer_mode: fleetOnboard.consumer_mode,
      organic_capture: fleetOnboard.organic_capture?.captured || 0,
      doctor_fleet_ready: fleetOnboard.doctor?.fleet_evidence?.fleet_submission_ready === true,
    },
    evolve: {
      ok: evolve.ok,
      procedures_mined: evolve.procedures_mined,
      team_events_ingested: evolve.team_events_ingested || 0,
      organic_memory_items: evolve.organic_memory_items || 0,
      scaffold_created: evolve.ritual_skill_scaffold?.created || 0,
    },
    project_skill_scaffolded: projectSkillScaffolded,
    project_skill_evaluated: projectSkillEvaluated,
    ritual_promote: { promoted: promoted.promoted, total: promoted.total, ok: promoted.ok },
    memory_sqlite: fs.existsSync(memorySqlite),
    consumer_procedures: fs.existsSync(consumerProcedures),
    skip_llm_exploration: r.skip_llm_exploration === true,
    overlap_source: r.overlap_source,
    tier: r.tier,
    tier_totals_recorded: hasTierTotals,
    delivered_tokens: delivered,
    cold_l3_tokens: cold,
    multiplier,
    target_multiplier: TARGET,
    target_met:
      r.skip_llm_exploration === true &&
      r.overlap_source === 'organic-worklog' &&
      projectSkillScaffolded &&
      projectSkillEvaluated &&
      multiplier <= TARGET &&
      fs.existsSync(memorySqlite),
  };

  fs.rmSync(consumerRoot, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`consumer-repo-descent: wrote ${outPath}`);
  console.log(
    `  capture=${captured.captured} evolve=${evolve.procedures_mined} skip_llm=${payload.skip_llm_exploration} ${r.tier} ${delivered}/${cold} (${(multiplier * 100).toFixed(3)}%) target_met=${payload.target_met}`
  );
  process.exit(payload.ok && payload.target_met ? 0 : 1);
}

function assertConsumerNotPack(consumerRoot, pluginRoot) {
  if (path.resolve(consumerRoot) === path.resolve(pluginRoot)) {
    throw new Error('consumer repo must not be the plugin pack root');
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
