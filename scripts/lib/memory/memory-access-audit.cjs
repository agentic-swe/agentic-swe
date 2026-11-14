'use strict';

/**
 * AE-038c — Auditable memory access and delete.
 * Append-only JSONL under .agentic-swe/memory-access-audit.jsonl.
 * Refs ADR-012; ADR-017; PD-53.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} projectRoot
 */
function memoryAccessAuditPath(projectRoot) {
  return path.join(path.resolve(projectRoot), '.agentic-swe', 'memory-access-audit.jsonl');
}

/**
 * @param {string} projectRoot
 * @param {object} entry
 */
function appendMemoryAccessAudit(projectRoot, entry) {
  const file = memoryAccessAuditPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row = {
    at: new Date().toISOString(),
    ...entry,
  };
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, 'utf8');
  return row;
}

/**
 * @param {string} projectRoot
 * @returns {object[]}
 */
function readMemoryAccessAudit(projectRoot) {
  const file = memoryAccessAuditPath(projectRoot);
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

module.exports = {
  memoryAccessAuditPath,
  appendMemoryAccessAudit,
  readMemoryAccessAudit,
};
