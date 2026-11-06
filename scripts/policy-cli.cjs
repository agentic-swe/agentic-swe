#!/usr/bin/env node
'use strict';

/**
 * agentic-swe policy — PDP helpers (AE-022).
 *   agentic-swe policy replay --work-dir <path> [--policy <file>]
 */

const fs = require('node:fs');
const path = require('node:path');
const { replayPolicyDecisions } = require('./lib/policy/replay.cjs');

function usage() {
  process.stderr.write(`Usage:
  agentic-swe policy replay --work-dir <path> [--policy <file.json>]

Re-evaluates every policy.decided journal event. Exit 0 when mismatches=0.
`);
}

function parseArgs(argv) {
  const out = { cmd: null, workDir: null, policyFile: null };
  const args = argv.slice();
  out.cmd = args.shift() || null;
  while (args.length) {
    const a = args.shift();
    if (a === '--work-dir' || a === '--workDir') out.workDir = args.shift();
    else if (a === '--policy') out.policyFile = args.shift();
    else if (a === '-h' || a === '--help') out.help = true;
    else {
      process.stderr.write(`unknown arg: ${a}\n`);
      out.help = true;
    }
  }
  return out;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.cmd || opts.help || opts.cmd === 'help') {
    usage();
    process.exit(opts.help || opts.cmd === 'help' ? 0 : 1);
  }
  if (opts.cmd !== 'replay') {
    process.stderr.write(`unknown policy subcommand: ${opts.cmd}\n`);
    usage();
    process.exit(1);
  }
  if (!opts.workDir) {
    process.stderr.write('policy replay requires --work-dir\n');
    process.exit(1);
  }
  const workDir = path.resolve(opts.workDir);
  let policy;
  if (opts.policyFile) {
    policy = JSON.parse(fs.readFileSync(path.resolve(opts.policyFile), 'utf8'));
  }
  const packRoot = path.join(__dirname, '..');
  const result = replayPolicyDecisions({ workDir, policy, packRoot });
  process.stdout.write(
    JSON.stringify(
      {
        ok: result.ok,
        checked: result.checked,
        mismatches: result.mismatches.length,
        details: result.mismatches,
      },
      null,
      2
    ) + '\n'
  );
  process.exit(result.ok ? 0 : 2);
}

main();
