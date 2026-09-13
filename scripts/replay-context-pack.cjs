#!/usr/bin/env node
/**
 * Zero-LLM replay of context-pack.json (scope reads + primary verify).
 *
 * Usage:
 *   node scripts/replay-context-pack.cjs --work-dir .worklogs/<id> [--project-root dir] [--json]
 */
'use strict';

const path = require('node:path');
const { projectRootFromWorkDir } = require('./lib/work-engine/budget-config.cjs');
const { replayContextPack, writeDescentReplayArtifact } = require('./lib/context/delegate-from-pack.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--work-dir') out.workDir = path.resolve(argv[++i]);
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.workDir) {
    console.error('replay-context-pack requires --work-dir');
    process.exit(2);
  }
  const projectRoot = args.projectRoot || projectRootFromWorkDir(args.workDir);
  const r = replayContextPack({ workDir: args.workDir, projectRoot });
  if (r.ok || r.steps) writeDescentReplayArtifact(args.workDir, r);
  if (args.json) console.log(JSON.stringify(r, null, 2));
  else if (r.ok) console.log('PACK REPLAY PASS', r.verify);
  else console.error('PACK REPLAY FAIL', r.reason);
  process.exit(r.ok ? 0 : 1);
}

main();
