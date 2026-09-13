#!/usr/bin/env node
/**
 * Bundle maintainer share artifacts for external consumer teams.
 *
 * Usage:
 *   node scripts/fleet-share-kit.cjs [--out-dir bench/results/fleet-share-kit] [--json]
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { buildConsumerFleetWorkflowYaml } = require('./lib/fleet/consumer-workflow.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--out-dir') out.outDir = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const date = new Date().toISOString().slice(0, 10);
  const outDir =
    args.outDir || path.join(pluginRoot, 'bench', 'results', `fleet-share-kit-${date}`);

  fs.mkdirSync(outDir, { recursive: true });

  const invitePath = path.join(outDir, 'fleet-team-invite.json');
  const workflowPath = path.join(outDir, 'agentic-swe-fleet-workflow.yml');
  const manifestPath = path.join(outDir, 'fleet-share-kit.json');

  const inviteRun = spawnSync(
    process.execPath,
    ['scripts/fleet-export-invite.cjs', '--out', invitePath],
    { cwd: pluginRoot, encoding: 'utf8' }
  );
  if (inviteRun.status !== 0) {
    console.error(inviteRun.stderr || inviteRun.stdout);
    process.exit(inviteRun.status || 1);
  }

  const workflowYaml = buildConsumerFleetWorkflowYaml({
    projectRoot: '/path/to/your-consumer-repo',
    pluginRoot: '../agentic-swe',
  });
  fs.writeFileSync(workflowPath, workflowYaml);

  const invite = JSON.parse(fs.readFileSync(invitePath, 'utf8'));
  const manifest = {
    generated_at: new Date().toISOString(),
    goal_complete: false,
    out_dir: outDir,
    artifacts: {
      invite: invitePath,
      workflow_template: workflowPath,
    },
    maintainer_status: invite.maintainer_status,
    consumer_commands: invite.consumer_setup,
    measurement_contract: invite.measurement_contract,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (args.json) console.log(JSON.stringify(manifest, null, 2));
  else {
    console.log(`fleet-share-kit: wrote ${outDir}`);
    console.log(`  invite: ${invitePath}`);
    console.log(`  workflow: ${workflowPath}`);
    console.log(
      `  independent consumers: ${invite.maintainer_status.independent_consumers}/${invite.maintainer_status.fleet_scale_target}`
    );
  }
}

main();
