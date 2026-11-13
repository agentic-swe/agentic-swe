'use strict';

/**
 * AE-031a — append-only learning_records.jsonl store.
 * Intentionally separate from graph-store / MemoryService sqlite adapters
 * (Lane A owns those files during AE-030e). Refs ADR-012, ADR-011.
 */

const fs = require('node:fs');
const path = require('node:path');
const { validateLearningRecord } = require('./learning-record.cjs');

const DEFAULT_STORE = '.agentic-swe/learning_records.jsonl';

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function learningStorePath(projectRoot) {
  return path.join(projectRoot, DEFAULT_STORE);
}

/**
 * @param {string} projectRoot
 * @returns {object[]}
 */
function readLearningRecords(projectRoot) {
  const file = learningStorePath(projectRoot);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line));
  }
  return out;
}

/**
 * Append one LearningRecord. Fail closed on schema violation.
 * @param {string} projectRoot
 * @param {object} record
 * @returns {object} the written record
 */
function appendLearningRecord(projectRoot, record) {
  const check = validateLearningRecord(record);
  if (!check.ok) {
    const detail = (check.errors || [])
      .map((e) => `${e.instancePath || '/'} ${e.message}`)
      .join('; ');
    const err = new Error(`learning record invalid: ${detail}`);
    err.code = 'LEARNING_RECORD_INVALID';
    err.errors = check.errors;
    throw err;
  }
  const file = learningStorePath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

/**
 * Replace store contents with a bundle (used by ingest rebuild / tests).
 * @param {string} projectRoot
 * @param {object[]} records
 */
function writeLearningBundle(projectRoot, records) {
  const file = learningStorePath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [];
  for (const record of records) {
    const check = validateLearningRecord(record);
    if (!check.ok) {
      const detail = (check.errors || [])
        .map((e) => `${e.instancePath || '/'} ${e.message}`)
        .join('; ');
      const err = new Error(`learning record invalid: ${detail}`);
      err.code = 'LEARNING_RECORD_INVALID';
      err.errors = check.errors;
      throw err;
    }
    lines.push(JSON.stringify(record));
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
  fs.renameSync(tmp, file);
  return records;
}

module.exports = {
  DEFAULT_STORE,
  learningStorePath,
  readLearningRecords,
  appendLearningRecord,
  writeLearningBundle,
};
