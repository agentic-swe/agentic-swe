#!/usr/bin/env node
'use strict';

const { reportHostParity } = require('./lib/host-parity/report.cjs');

function parseFlags(argv) {
  const opts = { json: false };
  for (const arg of argv) {
    if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return opts;
}

function main() {
  const opts = parseFlags(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: agentic-swe host-parity [--json]');
    return;
  }
  const rows = reportHostParity();
  if (opts.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  console.log('Host parity');
  for (const row of rows) {
    console.log(`  ${row.host}: ${row.status}`);
  }
}

if (require.main === module) main();
