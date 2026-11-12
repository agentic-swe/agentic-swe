#!/usr/bin/env node
/**
 * Run all *.test.js files under test/ via the built-in test runner.
 * Avoids `node --test test/` / `node --test test` differences between Node 20 and 22
 * (v22 can treat `test` as a module specifier instead of a directory).
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const testDir = path.join(root, 'test');

function collectTestFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      // Skip dependency trees and fixture trees (AE-028a contribution fixtures may
      // ship contract.test.js that are intentionally broken / only run via the validator).
      if (ent.name === 'node_modules' || ent.name === 'fixtures') continue;
      out.push(...collectTestFiles(p));
    } else if (ent.isFile() && ent.name.endsWith('.test.js')) {
      out.push(p);
    }
  }
  return out;
}

const files = collectTestFiles(testDir).sort();
if (files.length === 0) {
  console.error('run-node-tests: no *.test.js files under test/');
  process.exit(1);
}

const r = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: root,
  env: process.env,
});

if (r.signal) {
  process.exit(1);
}
process.exit(r.status ?? 1);
