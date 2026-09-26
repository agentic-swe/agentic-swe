'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256File } = require('./hash.cjs');

const RUNTIME_FILES = new Set([
  'jev.json', 'memory.sqlite', 'memory.sqlite-shm', 'memory.sqlite-wal',
  'procedures.json', 'catalog.json', 'catalog-embeddings.json', 'model-routing.json',
  'install-state.json',
]);

function isRuntimePath(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return RUNTIME_FILES.has(normalized) || normalized === 'skills' || normalized.startsWith('skills/') || normalized.startsWith('install-receipts/');
}

function manifestPath(destination) {
  return path.join(destination, 'install-state.json');
}

function readManifest(destination) {
  const file = manifestPath(destination);
  if (!fs.existsSync(file)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.files)) {
      throw new Error('corrupt manifest');
    }
    return manifest;
  } catch (error) {
    if (error.message === 'corrupt manifest') throw error;
    throw new Error('corrupt manifest');
  }
}

function writeManifest(destination, manifest) {
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(manifestPath(destination), `${JSON.stringify(manifest, null, 2)}\n`);
}

function walkFiles(directory, root = directory) {
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(root, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'install-receipts' || entry.name === 'skills') continue;
      out.push(...walkFiles(full, root));
    } else if (!isRuntimePath(relative)) out.push(relative);
  }
  return out;
}

function classifyDestination({ destination, manifest, packFiles }) {
  const current = [];
  const drifted = [];
  const preserved = [];
  const adoptable = [];
  const owned = new Map((manifest.files || []).map((file) => [file.path, file.sha256]));
  for (const relative of walkFiles(destination)) {
    const full = path.join(destination, relative);
    const actual = sha256File(full);
    if (owned.has(relative)) {
      if (owned.get(relative) === actual) current.push(relative);
      else drifted.push(relative);
    } else if (packFiles.get(relative) === actual) adoptable.push(relative);
    else preserved.push(relative);
  }
  return { current, drifted, preserved, adoptable };
}

module.exports = {
  classifyDestination,
  isRuntimePath,
  readManifest,
  writeManifest,
};
