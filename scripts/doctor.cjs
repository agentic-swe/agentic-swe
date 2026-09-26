#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { detectHosts, PORTABLE_ENTRIES } = require('./setup.cjs');
const { readManifest, classifyDestination } = require('./lib/install-state/manifest.cjs');
const { sha256File } = require('./lib/install-state/hash.cjs');

function jevReadiness(env) {
  if (env.AGENTIC_SWE_JEV === '0') return { state: 'disabled' };
  if (!env.TYPESAFE_API_KEY) return { state: 'missing_key' };
  return { state: 'ready' };
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

function inspect(options = {}, context = {}) {
  const packRoot = context.packRoot || path.resolve(__dirname, '..');
  const target = path.resolve(options.target || process.cwd());
  const checks = [];
  const add = (name, ok, detail, level = 'required') => checks.push({ name, ok, detail, level });

  add('Node.js', Number(process.versions.node.split('.')[0]) >= 18, process.version);
  add('Pack root', fs.existsSync(path.join(packRoot, 'CLAUDE.md')), packRoot);
  add('State machine', fs.existsSync(path.join(packRoot, 'state-machine.json')), path.join(packRoot, 'state-machine.json'));
  add('Target repository', fs.existsSync(target) && fs.statSync(target).isDirectory(), target);

  const hosts = detectHosts(context.home);
  add('Supported host', hosts.length > 0, hosts.length ? hosts.join(', ') : 'none detected', 'advisory');

  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    add('Project policy', fs.existsSync(path.join(target, 'CLAUDE.md')), path.join(target, 'CLAUDE.md'), 'advisory');
    add('Worklog ignore', hasWorklogIgnore(target), path.join(target, '.gitignore'), 'advisory');
  }

  const destination = path.join(target, '.agentic-swe');
  const manifestPath = path.join(destination, 'install-state.json');
  let manifest = { present: false };
  let drift = { count: 0 };
  let last_scan = null;
  try {
    const record = readManifest(destination);
    if (record) {
      manifest = { present: true, host: record.host, profile: record.profile };
      last_scan = record.last_scan ?? null;
      const classified = classifyDestination({
        destination,
        manifest: record,
        packFiles: packFilesMap(packRoot),
      });
      drift = { count: classified.drifted.length };
      add('Install manifest', true, manifestPath, 'advisory');
      add(
        'Owned-file drift',
        classified.drifted.length === 0,
        classified.drifted.length === 0 ? 'none' : `${classified.drifted.length} drifted`,
        'advisory',
      );
    } else {
      add('Install manifest', false, manifestPath, 'advisory');
    }
  } catch (error) {
    if (error.message === 'corrupt manifest') {
      manifest = { present: true, corrupt: true };
      add('Install manifest', false, 'corrupt manifest', 'required');
    } else {
      throw error;
    }
  }

  const env = context.env || process.env;

  return {
    ok: checks.every((check) => check.level !== 'required' || check.ok),
    target,
    hosts,
    checks,
    manifest,
    drift,
    last_scan,
    jev: jevReadiness(env),
  };
}

function hasWorklogIgnore(target) {
  const file = path.join(target, '.gitignore');
  if (!fs.existsSync(file)) return false;
  return /(?:^|\n)\s*\.worklogs\/?\s*(?:$|#)/m.test(fs.readFileSync(file, 'utf8'));
}

function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const targetIndex = args.indexOf('--target');
  const target = targetIndex >= 0 ? args[targetIndex + 1] : process.cwd();
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: agentic-swe doctor [--target <repo>] [--json]');
    return;
  }
  if (targetIndex >= 0 && !target) {
    console.error('error: --target requires a path');
    process.exitCode = 1;
    return;
  }

  const result = inspect({ target });
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('Agentic SWE doctor');
    for (const check of result.checks) {
      const marker = check.ok ? '✓' : check.level === 'required' ? '✗' : '!';
      console.log(`${marker} ${check.name}: ${check.detail}`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main();
else module.exports = { inspect, hasWorklogIgnore, jevReadiness };
