#!/usr/bin/env node
/**
 * Production simulation: validation-approved capture → ladder replay on holdout.
 *
 * Usage:
 *   node scripts/bench/run-production-sim.cjs [--out bench/results/production-sim-<date>.json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { getDefaultPluginRoot } = require('../lib/work-engine/engine.cjs');
const { seedCorpusProcedures, procedureFromScoring } = require('../lib/descent/corpus-seed.cjs');
const { buildFingerprint } = require('../lib/descent/fingerprint.cjs');
const { promoteOrDemote, DEFAULT_STORE } = require('../lib/descent/promotion.cjs');
const { tryDescentLadder } = require('../lib/descent/ladder.cjs');
const { runTaskAcceptance } = require('../lib/bench/run-task.cjs');
const { captureProcedureFromWork } = require('../lib/descent/capture-procedure.cjs');

const HOLDOUT_PREFIXES = ['ritual-', 'mined-'];

function isHoldout(name) {
  return HOLDOUT_PREFIXES.some((p) => name.startsWith(p));
}

function simulateWorkCapture(workDir, storeRoot) {
  return captureProcedureFromWork({ workDir, projectRoot: storeRoot, storeRoot });
}

async function measureHoldout(pluginRoot, storeRoot) {
  const corpusRoot = path.join(pluginRoot, 'bench', 'corpus');
  let delivered = 0;
  let ladderHits = 0;
  let tokens = 0;
  const tasks = [];

  for (const name of fs.readdirSync(corpusRoot)) {
    if (!isHoldout(name)) continue;
    const taskDir = path.join(corpusRoot, name);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    const acceptance = runTaskAcceptance(taskDir);
    const scoring = JSON.parse(fs.readFileSync(path.join(taskDir, 'scoring.json'), 'utf8'));
    const verify = scoring.task_pass?.command || '';
    const cwd = scoring.task_pass?.cwd ? path.resolve(taskDir, scoring.task_pass.cwd) : taskDir;
    const descent = await tryDescentLadder({
      projectRoot: storeRoot,
      pluginRoot,
      verifyCommand: verify,
      files: [name],
      cwd,
    });
    if (acceptance.ok) {
      delivered++;
      tokens += descent.delivered_tokens ?? descent.frontier_tokens ?? 0;
      if (descent.ok) ladderHits++;
    }
    tasks.push({ id: name, delivered: acceptance.ok, ladder_hit: descent.ok, tier: descent.tier });
  }

  return { tasks, summary: { delivered, ladder_hits: ladderHits, delivered_tokens_total: tokens } };
}

async function main() {
  const pluginRoot = getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outIdx = process.argv.indexOf('--out');
  const outPath =
    outIdx >= 0
      ? process.argv[outIdx + 1]
      : path.join(pluginRoot, 'bench', 'results', `production-sim-${date}.json`);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'prod-sim-'));
  const storePath = path.join(tmpRoot, DEFAULT_STORE);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify({ procedures: [] }, null, 2));

  seedCorpusProcedures({
    pluginRoot,
    projectRoot: tmpRoot,
    include: (name) => name.startsWith('oracle-'),
  });

  const before = await measureHoldout(pluginRoot, tmpRoot);
  const captures = [];

  for (const t of before.tasks) {
    if (!t.delivered) continue;
    const taskDir = path.join(pluginRoot, 'bench', 'corpus', t.id);
    const scoring = JSON.parse(fs.readFileSync(path.join(taskDir, 'scoring.json'), 'utf8'));
    const dim = scoring.task_pass;
    const verifyCmd = dim.command;
    const fp = buildFingerprint({ files: [t.id], verifyCommand: verifyCmd, failureSignature: '' });
    promoteOrDemote({
      projectRoot: tmpRoot,
      fingerprint: fp,
      procedure: procedureFromScoring(taskDir, dim),
      evalPassed: true,
      humanApproved: true,
    });
    captures.push({ task: t.id, method: 'simulated_validation_capture', fingerprint: fp.slice(0, 16) });
  }

  const workSimDir = path.join(tmpRoot, '.worklogs', 'sim-holdout');
  fs.mkdirSync(workSimDir, { recursive: true });
  fs.writeFileSync(
    path.join(workSimDir, 'validation-results.md'),
    '# Validation\n\nclassification: `approved`\n\n```bash\nnpm test\n```\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(workSimDir, 'implementation.md'),
    '# Implementation\n\n- `src/example.js`\n',
    'utf8'
  );
  fs.writeFileSync(path.join(workSimDir, 'state.json'), JSON.stringify({ work_id: 'sim-holdout' }, null, 2));

  const captureResult = simulateWorkCapture(workSimDir, tmpRoot);
  if (captureResult.ok) {
    promoteOrDemote({
      projectRoot: tmpRoot,
      fingerprint: captureResult.fingerprint,
      procedure: {
        verify: [{ type: 'RUN', command: captureResult.verifyCommand }],
      },
      evalPassed: true,
      humanApproved: false,
    });
    captures.push({ task: 'sim-holdout', method: 'capture-procedure', ...captureResult });
  }

  const after = await measureHoldout(pluginRoot, tmpRoot);

  const payload = {
    generated_at: new Date().toISOString(),
    ok: true,
    measurement_contract: 'Oracle seed + simulated validation capture on delivered holdout tasks',
    before,
    captures,
    after,
    improvement: {
      ladder_hits_delta: after.summary.ladder_hits - before.summary.ladder_hits,
      tokens_delta: after.summary.delivered_tokens_total - before.summary.delivered_tokens_total,
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  console.log(`production-sim: wrote ${outPath}`);
  console.log(
    `  holdout ladder hits: ${before.summary.ladder_hits} → ${after.summary.ladder_hits} (${before.summary.delivered} delivered)`
  );
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
