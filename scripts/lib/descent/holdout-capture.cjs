'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildFingerprint } = require('./fingerprint.cjs');
const { promoteOrDemote, DEFAULT_STORE } = require('./promotion.cjs');
const { procedureFromScoring } = require('./corpus-seed.cjs');
const { runTaskAcceptance } = require('../bench/run-task.cjs');

const HOLDOUT_PREFIXES = ['ritual-', 'mined-'];

function isHoldoutTask(name) {
  return HOLDOUT_PREFIXES.some((p) => name.startsWith(p));
}

function loadStore(projectRoot) {
  const p = path.join(projectRoot, DEFAULT_STORE);
  if (!fs.existsSync(p)) return { procedures: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveStore(projectRoot, data) {
  const p = path.join(projectRoot, DEFAULT_STORE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Remove holdout procedures that were corpus-seeded (circular) rather than validation-captured.
 * @param {string} projectRoot
 * @returns {{ removed: number }}
 */
function purgeHoldoutCorpusSeeds(projectRoot) {
  const data = loadStore(projectRoot);
  const before = data.procedures.length;
  data.procedures = data.procedures.filter((rec) => {
    const meta = rec.procedure?._meta;
    if (!meta?.taskDir) return true;
    const taskName = path.basename(meta.taskDir);
    if (!isHoldoutTask(taskName)) return true;
    if (meta.source === 'validation-approved') return true;
    if (meta.method === 'run_command') return false;
    return true;
  });
  saveStore(projectRoot, data);
  return { removed: before - data.procedures.length };
}

/**
 * Capture one holdout task as validation-approved (production learning path).
 * @param {{ pluginRoot: string, projectRoot: string, taskName: string, humanApproved?: boolean }} opts
 */
function captureHoldoutFromValidation(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot);
  const taskName = opts.taskName;
  const taskDir = path.join(pluginRoot, 'bench', 'corpus', taskName);
  if (!fs.existsSync(path.join(taskDir, 'scoring.json'))) {
    return { ok: false, reason: 'scoring.json missing' };
  }

  const acceptance = runTaskAcceptance(taskDir);
  if (!acceptance.ok) {
    return { ok: false, reason: 'acceptance failed', task: taskName };
  }

  const scoring = JSON.parse(fs.readFileSync(path.join(taskDir, 'scoring.json'), 'utf8'));
  const dim = scoring.task_pass;
  if (!dim?.command) {
    return { ok: false, reason: 'no verify command', task: taskName };
  }

  const verifyCmd = dim.command;
  const fp = buildFingerprint({ files: [taskName], verifyCommand: verifyCmd, failureSignature: '' });
  const procedure = procedureFromScoring(taskDir, dim);
  procedure._meta = {
    ...(procedure._meta || {}),
    source: 'validation-approved',
    captured_at: new Date().toISOString(),
    task: taskName,
  };

  const r = promoteOrDemote({
    projectRoot,
    fingerprint: fp,
    procedure,
    evalPassed: true,
    humanApproved: opts.humanApproved !== false,
  });

  return {
    ok: true,
    task: taskName,
    fingerprint: fp,
    tier: r.record.tier,
    verifyCommand: verifyCmd,
  };
}

/**
 * Purge circular holdout seeds and capture all delivered holdout tasks.
 * @param {{ pluginRoot: string, projectRoot: string, purge?: boolean }} opts
 */
function accumulateDeliveredHoldout(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot);
  const corpusRoot = path.join(pluginRoot, 'bench', 'corpus');

  let purged = { removed: 0 };
  if (opts.purge !== false) {
    purged = purgeHoldoutCorpusSeeds(projectRoot);
  }

  const captures = [];
  if (!fs.existsSync(corpusRoot)) {
    return { ok: false, error: 'bench/corpus missing', purged, captures };
  }

  for (const name of fs.readdirSync(corpusRoot)) {
    if (!isHoldoutTask(name)) continue;
    const taskDir = path.join(corpusRoot, name);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    const r = captureHoldoutFromValidation({ pluginRoot, projectRoot, taskName: name });
    if (r.ok) captures.push(r);
  }

  const delivered = captures.length;
  return {
    ok: true,
    purged,
    captures,
    delivered,
    store: path.join(projectRoot, DEFAULT_STORE),
  };
}

module.exports = {
  HOLDOUT_PREFIXES,
  isHoldoutTask,
  purgeHoldoutCorpusSeeds,
  captureHoldoutFromValidation,
  accumulateDeliveredHoldout,
};
