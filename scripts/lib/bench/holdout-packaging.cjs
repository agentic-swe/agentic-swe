'use strict';

/**
 * AE-034b — holdout packaging + train/eval isolation (ADR-013, PD-43, PD-48 C4).
 * Cold wipe of procedures + memory; content SHA pins; hidden oracle only in score phase.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  registerHoldoutBan,
  evalFingerprintForHoldout,
  assertNoContaminationInL0,
} = require('../shared/eval-learning-guard.cjs');

/**
 * Deterministic content hash of a task directory (sorted relative paths + bytes).
 * @param {string} taskDir
 * @returns {string} sha256 hex
 */
function hashTaskContent(taskDir) {
  const abs = path.resolve(taskDir);
  const files = [];
  const walk = (dir, rel = '') => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p, r);
      else files.push({ r, body: fs.readFileSync(p) });
    }
  };
  walk(abs);
  const h = crypto.createHash('sha256');
  for (const f of files) {
    h.update(f.r);
    h.update('\0');
    h.update(f.body);
    h.update('\0');
  }
  return h.digest('hex');
}

/**
 * Wipe learned procedures + memory DB for a cold eval worktree (PD-43 / C4).
 * @param {string} projectRoot
 */
function wipeEvalStores(projectRoot) {
  const root = path.resolve(projectRoot);
  const proc = path.join(root, '.agentic-swe', 'procedures.json');
  if (fs.existsSync(proc)) {
    fs.writeFileSync(proc, `${JSON.stringify({ procedures: [] }, null, 2)}\n`);
  } else {
    fs.mkdirSync(path.dirname(proc), { recursive: true });
    fs.writeFileSync(proc, `${JSON.stringify({ procedures: [] }, null, 2)}\n`);
  }
  const mem = path.join(root, '.agentic-swe', 'memory.sqlite');
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${mem}${suffix}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  const learn = path.join(root, '.agentic-swe', 'learning_records.jsonl');
  if (fs.existsSync(learn)) fs.writeFileSync(learn, '');
  const q = path.join(root, '.agentic-swe', 'learning_records.quarantine.jsonl');
  if (fs.existsSync(q)) fs.writeFileSync(q, '');
  return {
    ok: true,
    procedures: proc,
    memory_removed: !fs.existsSync(mem),
  };
}

/**
 * Prepare a cold E8-cited holdout run: wipe stores + ban holdout ids.
 * @param {{ projectRoot: string, holdoutIds: string[], e8Cited?: boolean }} opts
 */
function prepareColdHoldoutRun(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  if (opts.e8Cited !== false) {
    // C4: E8-cited runs must be cold.
    wipeEvalStores(projectRoot);
  }
  const fingerprints = (opts.holdoutIds || []).map(evalFingerprintForHoldout);
  registerHoldoutBan(projectRoot, {
    holdout_ids: opts.holdoutIds || [],
    fingerprints,
    labels: (opts.holdoutIds || []).map((id) => `holdout:${id}`),
  });
  return { ok: true, fingerprints, wiped: true };
}

/**
 * Load scoring oracle. Forbidden during the agent run phase (hidden scoring).
 * @param {string} taskDir
 * @param {{ phase: 'run' | 'score' }} opts
 */
function loadHiddenOracle(taskDir, opts) {
  const phase = opts && opts.phase;
  if (phase !== 'score') {
    const err = new Error('hidden oracle only available in score phase');
    err.code = 'HIDDEN_ORACLE_PHASE';
    err.path = 'phase';
    throw err;
  }
  const scoringPath = path.join(path.resolve(taskDir), 'scoring.json');
  if (!fs.existsSync(scoringPath)) {
    const err = new Error(`missing scoring oracle: ${scoringPath}`);
    err.code = 'ORACLE_MISSING';
    throw err;
  }
  return JSON.parse(fs.readFileSync(scoringPath, 'utf8'));
}

/**
 * Assert an eval run did not add L0 for a holdout id / fingerprint.
 * @param {string} projectRoot
 * @param {string} holdoutId
 */
function assertNoL0ForHoldout(projectRoot, holdoutId) {
  const fp = evalFingerprintForHoldout(holdoutId);
  assertNoContaminationInL0(projectRoot, fp);
  const procPath = path.join(projectRoot, '.agentic-swe', 'procedures.json');
  if (!fs.existsSync(procPath)) return { ok: true };
  const data = JSON.parse(fs.readFileSync(procPath, 'utf8'));
  for (const rec of data.procedures || []) {
    if (rec.tier !== 'L0') continue;
    const blob = JSON.stringify(rec);
    if (blob.includes(holdoutId) || rec.fingerprint === fp) {
      const err = new Error(`eval run added L0 for holdout ${holdoutId}`);
      err.code = 'HOLDOUT_L0_CONTAMINATION';
      err.path = 'procedures.L0';
      throw err;
    }
  }
  return { ok: true };
}

/**
 * Verify a manifest task's content_sha256 matches on-disk task path.
 * @param {{ content_sha256: string, path?: string }} task
 * @param {string} repoRoot
 */
function verifyTaskContentPin(task, repoRoot) {
  if (!task.path) {
    return { ok: true, skipped: true };
  }
  const taskDir = path.resolve(repoRoot, task.path);
  if (!fs.existsSync(taskDir)) {
    return { ok: false, errors: [`${task.path}: missing`] };
  }
  const actual = hashTaskContent(taskDir);
  if (actual !== task.content_sha256) {
    return {
      ok: false,
      errors: [
        `content_sha256 mismatch for ${task.id || task.path}: expected ${task.content_sha256}, got ${actual}`,
      ],
      actual,
    };
  }
  return { ok: true, actual };
}

module.exports = {
  hashTaskContent,
  wipeEvalStores,
  prepareColdHoldoutRun,
  loadHiddenOracle,
  assertNoL0ForHoldout,
  verifyTaskContentPin,
};
