'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256File } = require('../install-state/hash.cjs');

/** Critical pack paths relative to pack root (files or directories). */
const CRITICAL_PACK_PATHS = [
  'state-machine.json',
  'CLAUDE.md',
  'schemas',
  'scripts/lib/work-engine/artifacts.cjs',
  'scripts/lib/work-engine/transitions.cjs',
];

/**
 * Hash critical pack files for doctor --verify-pack.
 * @param {string} packRoot
 * @returns {{ ok: boolean, files: Array<{ path: string, sha256: string|null, ok: boolean }>, missing: string[] }}
 */
function verifyCriticalPackFiles(packRoot) {
  const files = [];
  const missing = [];

  function addFile(relative) {
    const full = path.join(packRoot, relative);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      missing.push(relative);
      files.push({ path: relative, sha256: null, ok: false });
      return;
    }
    files.push({ path: relative, sha256: sha256File(full), ok: true });
  }

  function walkDir(relativeDir) {
    const fullDir = path.join(packRoot, relativeDir);
    if (!fs.existsSync(fullDir) || !fs.statSync(fullDir).isDirectory()) {
      missing.push(relativeDir);
      files.push({ path: relativeDir, sha256: null, ok: false });
      return;
    }
    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      const relative = path.join(relativeDir, entry.name).split(path.sep).join('/');
      if (entry.isDirectory()) walkDir(relative);
      else addFile(relative);
    }
  }

  for (const entry of CRITICAL_PACK_PATHS) {
    const full = path.join(packRoot, entry);
    if (!fs.existsSync(full)) {
      missing.push(entry);
      files.push({ path: entry, sha256: null, ok: false });
      continue;
    }
    if (fs.statSync(full).isDirectory()) walkDir(entry);
    else addFile(entry);
  }

  return {
    ok: missing.length === 0 && files.every((f) => f.ok),
    files,
    missing,
  };
}

module.exports = { verifyCriticalPackFiles, CRITICAL_PACK_PATHS };
