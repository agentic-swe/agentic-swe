'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { writeJsonAtomic } = require('../shared/atomic-json.cjs');

const DEFAULT_STORE = '.agentic-swe/procedures.json';

function loadStore(projectRoot) {
  const p = path.join(projectRoot, DEFAULT_STORE);
  if (!fs.existsSync(p)) return { procedures: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveStore(projectRoot, data) {
  writeJsonAtomic(path.join(projectRoot, DEFAULT_STORE), data);
}

module.exports = { DEFAULT_STORE, loadStore, saveStore };
