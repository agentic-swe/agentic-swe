#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { scanSurfaces } = require('./lib/agent-surface/scan.cjs');
const { listInstalled, repair, updateInstalled, uninstall } = require('./lib/install-state/lifecycle.cjs');
const { sha256File } = require('./lib/install-state/hash.cjs');
const { PORTABLE_ENTRIES } = require('./setup.cjs');

const packRoot = path.resolve(__dirname, '..');

function parseFlags(argv) {
  const opts = { target: process.cwd(), json: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target' && argv[i + 1]) opts.target = path.resolve(argv[++i]);
    else if (arg === '--json') opts.json = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return opts;
}

function packFilesMap(root) {
  const map = new Map();
  function addFile(relative, full) {
    map.set(relative.split(path.sep).join('/'), sha256File(full));
  }
  function walkDir(relativeDir, fullDir) {
    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const full = path.join(fullDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walkDir(relative, full);
      } else addFile(relative, full);
    }
  }
  for (const entry of PORTABLE_ENTRIES) {
    const full = path.join(root, entry);
    if (!fs.existsSync(full)) continue;
    if (fs.statSync(full).isFile()) addFile(entry, full);
    else walkDir(entry, full);
  }
  return map;
}

function destinationFor(target) {
  return path.join(path.resolve(target), '.agentic-swe');
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runScan(opts) {
  const target = path.resolve(opts.target);
  const result = scanSurfaces({ roots: [target] });
  if (opts.json) printJson(result);
  else {
    console.log(`Scan: ${target}`);
    console.log(`Status: ${result.summary.status}`);
    for (const finding of result.findings) {
      console.log(`- [${finding.severity}] ${finding.message}`);
    }
  }
  if (result.summary.status === 'blocked') process.exit(2);
}

function runLifecycle(command, opts) {
  const destination = destinationFor(opts.target);
  const packFiles = packFilesMap(packRoot);
  const base = { destination, packRoot, packFiles, dryRun: opts.dryRun };
  let result;
  if (command === 'list-installed') result = listInstalled(base);
  else if (command === 'repair') result = repair(base);
  else if (command === 'update') result = updateInstalled(base);
  else if (command === 'uninstall') result = uninstall({ destination, dryRun: opts.dryRun });
  else throw new Error(`unknown command: ${command}`);
  if (opts.json) printJson(result);
  else console.log(JSON.stringify(result, null, 2));
}

function main() {
  const command = process.argv[2];
  if (!command || command === '--help' || command === '-h') {
    console.log(`Usage: control-plane <scan|list-installed|repair|update|uninstall> [--target <repo>] [--json] [--dry-run]`);
    return;
  }
  try {
    const opts = parseFlags(process.argv.slice(3));
    if (opts.help) {
      console.log(`Usage: control-plane ${command} [--target <repo>] [--json] [--dry-run]`);
      return;
    }
    if (command === 'scan') runScan(opts);
    else runLifecycle(command, opts);
  } catch (error) {
    console.error(`error: ${error.message || error}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
else module.exports = { parseFlags, packFilesMap, destinationFor };
