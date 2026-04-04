#!/usr/bin/env node
/**
 * Lightweight repo sanity check for CI: pipeline markdown trees are non-empty.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const phasesDir = path.join(root, 'phases');
const commandsDir = path.join(root, 'commands');

function countMd(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md')).length;
}

const nPhase = countMd(phasesDir);
const nCmd = countMd(commandsDir);

if (nPhase < 5) {
  console.error(`verify-sanity: expected at least 5 phase .md files, found ${nPhase}`);
  process.exit(1);
}
if (nCmd < 5) {
  console.error(`verify-sanity: expected at least 5 command .md files, found ${nCmd}`);
  process.exit(1);
}

console.log(`verify-sanity: OK (${nPhase} phases, ${nCmd} commands)`);
