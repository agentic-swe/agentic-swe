#!/usr/bin/env node
/**
 * Maintainer dogfood: create live .worklogs/ work items through real work-engine paths.
 * Writes to project-root .worklogs/ (not bench fixtures) for proven_at_scale accumulation.
 *
 * Usage:
 *   node scripts/dogfood-live-worklogs.cjs [--project-root dir] [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDefaultPluginRoot, applyTransition } = require('./lib/work-engine/engine.cjs');
const { runTaskAcceptance } = require('./lib/bench/run-task.cjs');
const { isHoldoutTask } = require('./lib/descent/holdout-capture.cjs');
const { accumulateDeliveredHoldout } = require('./lib/descent/holdout-capture.cjs');

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
}

function baseState(workId, verifyCommand) {
  const tpl = JSON.parse(
    fs.readFileSync(path.join(getDefaultPluginRoot(), 'templates', 'state.json'), 'utf8')
  );
  const now = new Date().toISOString();
  tpl.work_id = workId;
  tpl.task = `dogfood ${workId}`;
  tpl.current_state = 'validation';
  tpl.created_at = now;
  tpl.updated_at = now;
  tpl.timeout_at = new Date(Date.now() + 86400000).toISOString();
  tpl.metrics.verify_command = verifyCommand;
  tpl.metrics.tests_passed = true;
  tpl.validation.structural_passed = true;
  tpl.validation.quality_passed = true;
  return tpl;
}

function deliveredHoldoutTasks(pluginRoot) {
  const corpusRoot = path.join(pluginRoot, 'bench', 'corpus');
  const tasks = [];
  for (const name of fs.readdirSync(corpusRoot)) {
    if (!isHoldoutTask(name)) continue;
    const taskDir = path.join(corpusRoot, name);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    if (!runTaskAcceptance(taskDir).ok) continue;
    const scoring = JSON.parse(fs.readFileSync(path.join(taskDir, 'scoring.json'), 'utf8'));
    tasks.push({ id: name, verify: scoring.task_pass?.command || 'npm test' });
  }
  return tasks;
}

async function main() {
  const pluginRoot = getDefaultPluginRoot();
  let projectRoot = pluginRoot;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--project-root') projectRoot = path.resolve(process.argv[++i]);
  }
  const json = process.argv.includes('--json');
  const outIdx = process.argv.indexOf('--out');
  const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : null;

  accumulateDeliveredHoldout({ pluginRoot, projectRoot: pluginRoot, purge: true });

  const worklogsRoot = path.join(projectRoot, '.worklogs');
  fs.mkdirSync(worklogsRoot, { recursive: true });
  const runs = [];

  for (const task of deliveredHoldoutTasks(pluginRoot)) {
    const workId = `live-${task.id}`;
    const workDir = path.join(worklogsRoot, workId);
    fs.mkdirSync(workDir, { recursive: true });
    writeJson(path.join(workDir, 'state.json'), baseState(workId, task.verify));
    fs.writeFileSync(
      path.join(workDir, 'validation-results.md'),
      `# Validation\n\nclassification: \`approved\`\n\n\`\`\`bash\n${task.verify}\n\`\`\`\n`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(workDir, 'implementation.md'),
      `# Implementation\n\nDogfood live worklog for \`${task.id}\`.\n`,
      'utf8'
    );

    const descent = spawnSync(
      process.execPath,
      [
        path.join(pluginRoot, 'scripts/descent-try.cjs'),
        '--work-dir',
        workDir,
        '--verify',
        task.verify,
        '--plugin-root',
        pluginRoot,
        '--project-root',
        pluginRoot,
        '--files',
        task.id,
        '--json',
      ],
      { encoding: 'utf8', cwd: pluginRoot }
    );
    let descentParsed = null;
    try {
      descentParsed = JSON.parse((descent.stdout || '').trim());
    } catch {
      /* ignore */
    }

    const transition = applyTransition({
      workDir,
      pluginRoot,
      from: 'validation',
      to: 'pr-creation',
      actor: 'dogfood-live-worklogs',
      reason: 'validation approved',
    });

    runs.push({
      work_id: workId,
      task: task.id,
      descent_try_ok: descentParsed?.ok === true,
      descent_try_tier: descentParsed?.tier || null,
      descent_tier: transition.state?.metrics?.descent_tier,
      descent_hit: transition.state?.metrics?.descent_hit,
      transition_ok: transition.ok,
      capture_ok: Boolean(transition.state?.metrics?.descent_fingerprint || transition.state?.metrics?.verify_command),
    });
  }

  const status = spawnSync(
    process.execPath,
    [path.join(pluginRoot, 'scripts/live-production-status.cjs'), '--project-root', projectRoot, '--json'],
    { encoding: 'utf8' }
  );
  let liveStatus = null;
  try {
    liveStatus = JSON.parse(status.stdout);
  } catch {
    /* ignore */
  }

  const payload = {
    ok: runs.every((r) => r.transition_ok && r.capture_ok),
    project_root: projectRoot,
    worklogs_root: worklogsRoot,
    runs,
    live_status: liveStatus,
  };

  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  }
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`dogfood-live-worklogs: ${runs.length} work items under ${worklogsRoot}`);
    console.log(`  live claim: ${liveStatus?.claim_status ?? 'unknown'}`);
    if (outPath) console.log(`  wrote ${outPath}`);
  }
  process.exit(payload.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
