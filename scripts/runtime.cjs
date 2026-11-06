#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { createRuntime } = require('./lib/hosted-runtime/index.cjs');

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--json') out.json = true;
    else if (flag === '--work-dir') out.workDir = argv[++i];
    else if (flag === '--plugin-root') out.pluginRoot = argv[++i];
    else if (flag === '--track') out.track = argv[++i];
    else if (flag === '--provider') out.provider = argv[++i];
    else if (flag === '--max-steps') out.maxSteps = Number(argv[++i]);
  }
  out.command = argv[2];
  return out;
}

async function main() {
  const parsed = args(process.argv);
  if (parsed.command !== 'run' || !parsed.workDir) {
    throw new Error('usage: node scripts/runtime.cjs run --work-dir <dir> [--track lean|standard|rigorous] [--provider fixture] [--json]');
  }
  const result = await createRuntime({
    ...parsed,
    workDir: path.resolve(parsed.workDir),
    pluginRoot: parsed.pluginRoot || path.join(__dirname, '..'),
  }).run({ maxSteps: parsed.maxSteps });
  if (parsed.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(`${result.ok ? 'runtime stopped at ' : 'runtime failed: '}${result.current_state || result.code}\n`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
});
