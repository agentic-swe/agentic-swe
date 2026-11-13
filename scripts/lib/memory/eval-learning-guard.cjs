'use strict';

/**
 * AE-031c — eval vs learning store separation (ADR-013).
 * Holdout labels / eval fingerprints must not train learning or L0 seeds.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const BAN_FILE = '.agentic-swe/eval-holdout-ban.json';

/**
 * @param {string} projectRoot
 */
function banFilePath(projectRoot) {
  return path.join(projectRoot, BAN_FILE);
}

/**
 * @param {string} projectRoot
 * @returns {{ fingerprints: string[], holdout_ids: string[], labels: string[] }}
 */
function loadHoldoutBan(projectRoot) {
  const file = banFilePath(projectRoot);
  if (!fs.existsSync(file)) {
    return { fingerprints: [], holdout_ids: [], labels: [] };
  }
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      fingerprints: Array.isArray(doc.fingerprints) ? doc.fingerprints.map(String) : [],
      holdout_ids: Array.isArray(doc.holdout_ids) ? doc.holdout_ids.map(String) : [],
      labels: Array.isArray(doc.labels) ? doc.labels.map(String) : [],
    };
  } catch {
    return { fingerprints: [], holdout_ids: [], labels: [] };
  }
}

/**
 * Register holdout ids / fingerprints / labels banned from learning writers.
 * @param {string} projectRoot
 * @param {{ fingerprints?: string[], holdout_ids?: string[], labels?: string[] }} ban
 */
function registerHoldoutBan(projectRoot, ban = {}) {
  const cur = loadHoldoutBan(projectRoot);
  const next = {
    fingerprints: unique([...cur.fingerprints, ...(ban.fingerprints || [])]),
    holdout_ids: unique([...cur.holdout_ids, ...(ban.holdout_ids || [])]),
    labels: unique([...cur.labels, ...(ban.labels || [])]),
    updated_at: new Date().toISOString(),
  };
  const file = banFilePath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

function unique(arr) {
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
}

/**
 * Stable fingerprint for an eval/holdout task id (contamination canary).
 * @param {string} holdoutId
 */
function evalFingerprintForHoldout(holdoutId) {
  return crypto
    .createHash('sha256')
    .update(`eval-holdout:${String(holdoutId)}`, 'utf8')
    .digest('hex');
}

/**
 * Fail closed if a learning write mentions banned holdout material.
 * @param {object} record
 * @param {string} projectRoot
 */
function assertLearningWriteAllowed(record, projectRoot) {
  const ban = loadHoldoutBan(projectRoot);
  const hay = JSON.stringify({
    body: record.body,
    payload: record.payload,
    work_id: record.work_id,
    id: record.id,
    fingerprint: record.fingerprint,
    capture_source: record.capture_source,
  });
  for (const fp of ban.fingerprints) {
    if (hay.includes(fp) || record.fingerprint === fp) {
      const err = new Error(`learning write blocked: eval fingerprint ${fp}`);
      err.code = 'EVAL_LEARNING_CONTAMINATION';
      err.path = 'fingerprint';
      throw err;
    }
  }
  for (const id of ban.holdout_ids) {
    if (hay.includes(id)) {
      const err = new Error(`learning write blocked: holdout id ${id}`);
      err.code = 'EVAL_LEARNING_CONTAMINATION';
      err.path = 'holdout_id';
      throw err;
    }
  }
  for (const label of ban.labels) {
    if (hay.includes(label)) {
      const err = new Error(`learning write blocked: holdout label ${label}`);
      err.code = 'EVAL_LEARNING_CONTAMINATION';
      err.path = 'label';
      throw err;
    }
  }
  // Evaluation-scoped memory must never be copied into learning records.
  if (record.scope === 'evaluation' || record.memory_scope === 'evaluation') {
    const err = new Error('learning write blocked: evaluation scope');
    err.code = 'EVAL_SCOPE_WRITE_GUARD';
    err.path = 'scope';
    throw err;
  }
  return { ok: true };
}

/**
 * Learning subscribers must not read holdout/evaluation labels.
 * @param {{ scope?: string, purpose?: string }} query
 */
function assertLearningReadAllowed(query = {}) {
  const purpose = String(query.purpose || 'learning');
  if (purpose === 'learning' || purpose === 'learning_subscriber') {
    if (String(query.scope || '') === 'evaluation') {
      const err = new Error('learning subscriber cannot read evaluation scope');
      err.code = 'EVAL_SCOPE_READ_DENIED';
      err.path = 'scope';
      throw err;
    }
  }
  return { ok: true };
}

/**
 * After a guarded eval run: assert no banned fingerprint landed in L0 procedures
 * or live learning records.
 * @param {string} projectRoot
 * @param {string} fingerprint
 */
function assertNoContaminationInL0(projectRoot, fingerprint) {
  const fp = String(fingerprint);
  const procPath = path.join(projectRoot, '.agentic-swe', 'procedures.json');
  if (fs.existsSync(procPath)) {
    const data = JSON.parse(fs.readFileSync(procPath, 'utf8'));
    for (const rec of data.procedures || []) {
      if (rec.tier === 'L0' && (rec.fingerprint === fp || JSON.stringify(rec).includes(fp))) {
        const err = new Error(`contamination: eval fingerprint in L0 ${fp}`);
        err.code = 'EVAL_LEARNING_CONTAMINATION';
        err.path = 'procedures.L0';
        throw err;
      }
    }
  }
  const learnPath = path.join(projectRoot, '.agentic-swe', 'learning_records.jsonl');
  if (fs.existsSync(learnPath)) {
    for (const line of fs.readFileSync(learnPath, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      if (line.includes(fp)) {
        const err = new Error(`contamination: eval fingerprint in learning store ${fp}`);
        err.code = 'EVAL_LEARNING_CONTAMINATION';
        err.path = 'learning_records';
        throw err;
      }
    }
  }
  return { ok: true };
}

/**
 * Guarded eval run helper: register ban, run fn, assert no L0 contamination.
 * @param {{ projectRoot: string, holdoutId: string, run: () => unknown }} opts
 */
function runGuardedEval(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const holdoutId = String(opts.holdoutId);
  const fingerprint = evalFingerprintForHoldout(holdoutId);
  registerHoldoutBan(projectRoot, {
    fingerprints: [fingerprint],
    holdout_ids: [holdoutId],
    labels: [`holdout:${holdoutId}`],
  });
  const result = opts.run({ fingerprint, holdoutId, projectRoot });
  assertNoContaminationInL0(projectRoot, fingerprint);
  return { result, fingerprint, holdoutId };
}

module.exports = {
  BAN_FILE,
  banFilePath,
  loadHoldoutBan,
  registerHoldoutBan,
  evalFingerprintForHoldout,
  assertLearningWriteAllowed,
  assertLearningReadAllowed,
  assertNoContaminationInL0,
  runGuardedEval,
};
