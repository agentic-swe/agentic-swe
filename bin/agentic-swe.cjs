#!/usr/bin/env node
/**
 * Minimal CLI for npm-installed pack: print absolute plugin root or version.
 * Usage:
 *   agentic-swe path | pack-path   → stdout: directory containing CLAUDE.md, commands/, …
 *   agentic-swe version            → stdout: semver from package.json
 *   agentic-swe receipt [args]     → render receipt for a worklog (delegates to scripts/render-receipt.cjs)
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const argv = process.argv.slice(2);
const cmd = argv[0] || 'help';

function usage() {
  process.stderr.write(`agentic-swe — ${pkg.description || 'agentic-swe pack'}\n\n`);
  process.stderr.write(`Usage:\n`);
  process.stderr.write(`  agentic-swe path | pack-path   Print absolute pack root (for --plugin-dir / Cursor AGENTIC_SWE_PACK_ROOT)\n`);
  process.stderr.write(`  agentic-swe version             Print ${pkg.name}@${pkg.version}\n`);
  process.stderr.write(`  agentic-swe setup [args]        Configure one or more supported coding hosts\n`);
  process.stderr.write(`  agentic-swe doctor [args]       Check the tool, host detection, and project setup\n`);
  process.stderr.write(`  agentic-swe receipt [args]      Render a receipt for a worklog (passes args to scripts/render-receipt.cjs)\n`);
  process.stderr.write(`  agentic-swe goal [args]         Run the goal-loop engine (passes args to scripts/goal-engine.cjs)\n`);
  process.stderr.write(`  agentic-swe help                Show this message\n`);
}

if (cmd === 'setup') {
  const script = path.join(root, 'scripts', 'setup.cjs');
  const res = spawnSync(process.execPath, [script, ...argv.slice(1)], { stdio: 'inherit' });
  process.exit(res.status == null ? 1 : res.status);
}

if (cmd === 'doctor') {
  const script = path.join(root, 'scripts', 'doctor.cjs');
  const res = spawnSync(process.execPath, [script, ...argv.slice(1)], { stdio: 'inherit' });
  process.exit(res.status == null ? 1 : res.status);
}

if (cmd === 'receipt') {
  const script = path.join(root, 'scripts', 'render-receipt.cjs');
  const res = spawnSync(process.execPath, [script, ...argv.slice(1)], { stdio: 'inherit' });
  process.exit(res.status == null ? 1 : res.status);
}

if (cmd === 'goal') {
  const script = path.join(root, 'scripts', 'goal-engine.cjs');
  const res = spawnSync(process.execPath, [script, ...argv.slice(1)], { stdio: 'inherit' });
  process.exit(res.status == null ? 1 : res.status);
}

if (cmd === 'path' || cmd === 'pack-path') {
  if (!fs.existsSync(path.join(root, 'CLAUDE.md'))) {
    process.stderr.write(`error: pack root missing CLAUDE.md: ${root}\n`);
    process.exit(1);
  }
  process.stdout.write(`${root}\n`);
  process.exit(0);
}

if (cmd === 'version' || cmd === '-v' || cmd === '--version') {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

if (cmd === 'help' || cmd === '-h' || cmd === '--help') {
  usage();
  process.exit(0);
}

usage();
process.exit(1);
