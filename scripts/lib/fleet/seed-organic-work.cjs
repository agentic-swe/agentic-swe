'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDefaultPluginRoot, applyTransition } = require('../work-engine/engine.cjs');
const { emptyTierTotals } = require('../bench/tier-totals.cjs');
const { captureOrganicWorklogs } = require('../descent/capture-organic-worklogs.cjs');

const FLEET_EVIDENCE_CLASSES = new Set(['independent', 'maintainer_dogfood', 'bootstrap']);

function normalizeFleetEvidenceClass(value) {
  const cls = String(value || 'independent').trim();
  return FLEET_EVIDENCE_CLASSES.has(cls) ? cls : 'independent';
}

function isIndependentFleetSubmission(submission) {
  return normalizeFleetEvidenceClass(submission?.fleet_evidence_class) === 'independent';
}

function ensureConsumerTestHarness(projectRoot) {
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(
      pkgPath,
      JSON.stringify(
        { name: path.basename(projectRoot), private: true, scripts: { test: 'node --test test/ok.test.js' } },
        null,
        2
      ) + '\n'
    );
  } else {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (!pkg.scripts?.test) {
        pkg.scripts = pkg.scripts || {};
        pkg.scripts.test = 'node --test test/ok.test.js';
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      }
    } catch {
      /* keep existing */
    }
  }
  const testDir = path.join(projectRoot, 'test');
  fs.mkdirSync(testDir, { recursive: true });
  const okTest = path.join(testDir, 'ok.test.js');
  if (!fs.existsSync(okTest)) {
    fs.writeFileSync(
      okTest,
      `'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('ok', () => assert.equal(1, 1));
`
    );
  }
}

function writeValidationArtifacts(workDir, verifyCommand) {
  fs.writeFileSync(
    path.join(workDir, 'implementation.md'),
    `# Implementation\n\n\`\`\`bash\n${verifyCommand}\n\`\`\`\n`,
    'utf8'
  );
  fs.writeFileSync(
    path.join(workDir, 'validation-results.md'),
    `# Validation\n\nclassification: \`approved\`\n\n\`\`\`bash\n${verifyCommand}\n\`\`\`\n`,
    'utf8'
  );
}

/**
 * Seed organic /work items in a consumer repo (work-engine transitions, not dogfood actor).
 * @param {{ projectRoot: string, pluginRoot?: string, count?: number, verifyCommand?: string }} opts
 */
function seedOrganicWorkItems(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot || getDefaultPluginRoot());
  const projectRoot = path.resolve(opts.projectRoot);
  const count = opts.count || 3;
  const verifyCommand = opts.verifyCommand || 'npm test';

  ensureConsumerTestHarness(projectRoot);

  const worklogsRoot = path.join(projectRoot, '.worklogs');
  fs.mkdirSync(worklogsRoot, { recursive: true });
  const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
  const seeded = [];

  for (let i = 0; i < count; i++) {
    const workId = `fleet-organic-${i + 1}`;
    const workDir = path.join(worklogsRoot, workId);
    if (fs.existsSync(workDir)) {
      seeded.push({ work_id: workId, skipped: true, reason: 'exists' });
      continue;
    }
    fs.mkdirSync(workDir, { recursive: true });
    const now = new Date().toISOString();
    const state = { ...tpl };
    state.work_id = workId;
    state.task = `fleet organic seed ${workId}`;
    state.current_state = 'validation';
    state.created_at = now;
    state.updated_at = now;
    state.timeout_at = new Date(Date.now() + 86400000).toISOString();
    state.metrics = state.metrics || {};
    state.metrics.verify_command = verifyCommand;
    state.metrics.tests_passed = true;
    state.validation = state.validation || {};
    state.validation.structural_passed = true;
    state.validation.quality_passed = true;
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
    writeValidationArtifacts(workDir, verifyCommand);

    spawnSync(
      process.execPath,
      [
        path.join(pluginRoot, 'scripts/descent-try.cjs'),
        '--work-dir',
        workDir,
        '--verify',
        verifyCommand,
        '--plugin-root',
        pluginRoot,
        '--project-root',
        projectRoot,
        '--json',
      ],
      { encoding: 'utf8', cwd: projectRoot }
    );

    const toPr = applyTransition({
      workDir,
      pluginRoot,
      from: 'validation',
      to: 'pr-creation',
      actor: 'engineer',
      reason: 'validation approved',
      procedureStoreRoot: projectRoot,
    });
    const toDone = applyTransition({
      workDir,
      pluginRoot,
      from: 'pr-creation',
      to: 'completed',
      actor: 'user',
      reason: 'merged',
      procedureStoreRoot: projectRoot,
    });

    const finalState = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
    if (!finalState.budget?.tier_totals) {
      finalState.budget = finalState.budget || {};
      finalState.budget.tier_totals = emptyTierTotals();
      fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(finalState, null, 2) + '\n');
    }

    seeded.push({
      work_id: workId,
      transition_pr_ok: toPr.ok === true,
      transition_done_ok: toDone.ok === true,
      has_tier_totals: Boolean(finalState.budget?.tier_totals),
    });
  }

  let captured = { captured: 0, skipped: 0 };
  try {
    captured = captureOrganicWorklogs({
      projectRoot,
      pluginRoot,
      includeFixtures: false,
      preferIsolatedTest: true,
    });
  } catch {
    /* optional */
  }

  return { seeded, captured, verify_command: verifyCommand };
}

module.exports = {
  FLEET_EVIDENCE_CLASSES,
  normalizeFleetEvidenceClass,
  isIndependentFleetSubmission,
  ensureConsumerTestHarness,
  seedOrganicWorkItems,
};
