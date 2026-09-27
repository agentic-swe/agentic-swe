'use strict';

const path = require('node:path');
const { runIncrementalIndex } = require('../memory/incremental-index.cjs');
const { writeLessons } = require('../../memory-reflect.cjs');
const { buildStyleProfile, writeStyleProfile } = require('../memory/style-profile.cjs');
const { quarantineProcedures } = require('../descent/procedure-hygiene.cjs');
const { writeHookReceipt, readHookNotice } = require('./hook-receipt.cjs');

function refreshReflection(projectRoot, pluginRoot) {
  const lessonsPath = writeLessons(projectRoot);
  const profile = buildStyleProfile({
    projectRoot,
    pluginRoot,
    sessionFiles: [],
  });
  writeStyleProfile(projectRoot, profile);
  return {
    ok: true,
    lessonsPath,
    constraints: profile.constraints.length,
  };
}

/**
 * Bounded automatic maintenance: changed-file index, reflection refresh, procedure hygiene.
 * Failures are recorded and do not abort the remaining steps.
 * @param {{ projectRoot: string, pluginRoot: string, hook: string }} opts
 */
async function runMaintenance(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot || projectRoot);
  const failures = [];
  const steps = {};

  async function step(name, fn) {
    try {
      steps[name] = await fn();
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      failures.push({ step: name, message });
      steps[name] = { ok: false, error: message };
    }
  }

  await step('incremental-index', () => runIncrementalIndex({ projectRoot, pluginRoot }));
  await step('reflection-refresh', async () => refreshReflection(projectRoot, pluginRoot));
  await step('procedure-hygiene', async () => quarantineProcedures(projectRoot));

  const receipt = writeHookReceipt({
    projectRoot,
    hook: opts.hook,
    ok: failures.length === 0,
    failures,
    steps,
  });
  return {
    ok: failures.length === 0,
    failures,
    steps,
    notice: readHookNotice(projectRoot),
    receipt,
  };
}

function parseArgs(argv) {
  const out = { hook: 'maintain', json: false };
  const args = argv.slice(2);
  if (args[0] && !args[0].startsWith('--')) out.hook = args[0];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--project-root') out.projectRoot = path.resolve(args[++i]);
    else if (args[i] === '--plugin-root') out.pluginRoot = path.resolve(args[++i]);
    else if (args[i] === '--json') out.json = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const projectRoot = args.projectRoot || process.env.AGENTIC_SWE_PROJECT_ROOT || process.cwd();
  const pluginRoot = args.pluginRoot || path.resolve(__dirname, '..', '..', '..');
  const result = await runMaintenance({
    projectRoot,
    pluginRoot,
    hook: args.hook,
  });
  if (args.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (!result.ok) process.stderr.write(result.notice || 'hook lifecycle failed\n');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.message ? error.message : error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  runMaintenance,
  refreshReflection,
};
