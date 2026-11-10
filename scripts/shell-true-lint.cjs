#!/usr/bin/env node
'use strict';

/**
 * ADR-009: fail if scripts/ (excluding this linter's own docs) introduce shell:true
 * or string-form execSync/spawnSync with shell.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SHELL_TRUE = /shell\s*:\s*true\b/;
const SKIP = new Set(['scripts/shell-true-lint.cjs']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(cjs|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

function main() {
  const hits = [];
  for (const file of walk(path.join(ROOT, 'scripts'))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (SKIP.has(rel)) continue;
    const src = fs.readFileSync(file, 'utf8');
    if (SHELL_TRUE.test(src)) hits.push(rel);
  }
  if (hits.length) {
    console.error('shell-true-lint: FAIL — shell:true is forbidden under scripts/ (ADR-009):');
    for (const h of hits) console.error(`  - ${h}`);
    process.exit(1);
  }
  console.log('shell-true-lint: OK (no shell:true under scripts/)');
}

if (require.main === module) main();
module.exports = { SHELL_TRUE };
