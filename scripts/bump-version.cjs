#!/usr/bin/env node
'use strict';

/**
 * Node port of scripts/bump-version.sh for environments without jq (e.g. WSL without apt).
 * Usage: node scripts/bump-version.cjs check | bump <version>
 */

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const configPath = path.join(repoRoot, '.version-bump.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function getBySelector(obj, sel) {
  if (sel === '.version') return obj.version;
  if (sel === '.plugins[0].version') return obj.plugins && obj.plugins[0] && obj.plugins[0].version;
  throw new Error(`unsupported versionSelector: ${sel}`);
}

function setBySelector(obj, sel, version) {
  if (sel === '.version') {
    obj.version = version;
    return;
  }
  if (sel === '.plugins[0].version') {
    if (!Array.isArray(obj.plugins) || !obj.plugins[0]) throw new Error(`no plugins[0] in ${sel}`);
    obj.plugins[0].version = version;
    return;
  }
  throw new Error(`unsupported versionSelector: ${sel}`);
}

function cmdCheck() {
  if (!fs.existsSync(configPath)) {
    console.error('ERROR: .version-bump.json not found at repo root');
    process.exit(1);
  }
  const config = readJson(configPath);
  const canonical = readJson(path.join(repoRoot, 'package.json')).version;
  console.log(`Canonical version (package.json): ${canonical}`);
  console.log('');
  let drift = 0;
  for (const entry of config.files || []) {
    const file = entry.path;
    const sel = entry.versionSelector || '.version';
    const full = path.join(repoRoot, file);
    if (!fs.existsSync(full)) {
      console.log(`  MISSING: ${file}`);
      drift = 1;
      continue;
    }
    const ver = getBySelector(readJson(full), sel);
    if (ver === canonical) console.log(`  OK:      ${file} (${ver})`);
    else {
      console.log(`  DRIFT:   ${file} (${ver} != ${canonical})`);
      drift = 1;
    }
  }
  console.log('');
  if (drift) {
    console.log(`Version drift detected. Run: node scripts/bump-version.cjs bump ${canonical}`);
    process.exit(1);
  }
  console.log('All versions in sync.');
}

function cmdBump(version) {
  if (!version) {
    console.error('Usage: node scripts/bump-version.cjs bump <version>');
    process.exit(1);
  }
  const config = readJson(configPath);
  console.log(`Bumping all manifests to ${version}`);
  console.log('');
  for (const entry of config.files || []) {
    const file = entry.path;
    const sel = entry.versionSelector || '.version';
    const full = path.join(repoRoot, file);
    if (!fs.existsSync(full)) {
      console.log(`  SKIP: ${file} (not found)`);
      continue;
    }
    const data = readJson(full);
    setBySelector(data, sel, version);
    writeJson(full, data);
    console.log(`  DONE: ${file} -> ${version}`);
  }
  console.log('');
  console.log('All manifests updated. Verify with: node scripts/bump-version.cjs check');
}

const cmd = process.argv[2] || 'check';
if (cmd === 'check') cmdCheck();
else if (cmd === 'bump') cmdBump(process.argv[3]);
else {
  console.error('Usage: node scripts/bump-version.cjs {check|bump <version>}');
  process.exit(1);
}
