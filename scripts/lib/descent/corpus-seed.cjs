'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildFingerprint } = require('./fingerprint.cjs');
const { promoteOrDemote } = require('./promotion.cjs');

/**
 * Build procedure object from corpus scoring task_pass dimension.
 * @param {string} taskDir abs
 * @param {object} dim scoring.task_pass
 */
function procedureFromScoring(taskDir, dim) {
  const cwd = dim.cwd ? path.resolve(taskDir, dim.cwd) : taskDir;
  const cmd = dim.command;
  return {
    preconditions: [],
    actions: [{ type: 'RUN', command: cmd, cwd }],
    verify: [{ type: 'RUN', command: cmd, cwd }],
    _meta: { taskDir, method: dim.method },
  };
}

/**
 * Seed L0 procedures from bench/corpus/* tasks with runnable acceptance.
 * @param {{ pluginRoot: string, projectRoot?: string, include?: (name: string) => boolean }} opts
 */
function seedCorpusProcedures(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot || pluginRoot);
  const corpusRoot = path.join(pluginRoot, 'bench', 'corpus');
  const include = opts.include || (() => true);
  if (!fs.existsSync(corpusRoot)) {
    return { ok: false, error: 'bench/corpus missing' };
  }

  let seeded = 0;
  const entries = fs.readdirSync(corpusRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const ent of entries) {
    if (!include(ent.name)) continue;
    const taskDir = path.join(corpusRoot, ent.name);
    const scoringPath = path.join(taskDir, 'scoring.json');
    if (!fs.existsSync(scoringPath)) continue;
    const scoring = JSON.parse(fs.readFileSync(scoringPath, 'utf8'));
    const dim = scoring.task_pass;
    if (!dim || (dim.method !== 'run_command' && dim.method !== 'run_acceptance_tests')) continue;

    const taskJsonPath = path.join(taskDir, 'task.json');
    let files = [ent.name];
    if (fs.existsSync(taskJsonPath)) {
      try {
        const tj = JSON.parse(fs.readFileSync(taskJsonPath, 'utf8'));
        if (Array.isArray(tj.files)) files = tj.files;
      } catch {
        /* ignore */
      }
    }

    const verifyCmd = dim.command || ent.name;
    const fp = buildFingerprint({ files, verifyCommand: verifyCmd, failureSignature: '' });
    const procedure = procedureFromScoring(taskDir, dim);
    promoteOrDemote({
      projectRoot,
      fingerprint: fp,
      procedure,
      evalPassed: true,
      humanApproved: true,
    });
    seeded++;
  }

  return { ok: true, seeded, store: path.join(projectRoot, '.agentic-swe/procedures.json') };
}

/**
 * Find best L0 procedure match for a verify command.
 * @param {string} projectRoot
 * @param {string} verifyCommand
 */
function findProcedureByVerify(projectRoot, verifyCommand) {
  const data = loadStore(projectRoot);
  const norm = String(verifyCommand || '').trim();
  for (const rec of data.procedures) {
    if (rec.tier !== 'L0') continue;
    const verify = rec.procedure?.verify?.[0]?.command || rec.procedure?.actions?.[0]?.command;
    if (verify && verify.trim() === norm) return rec;
  }
  return null;
}

function loadStore(projectRoot) {
  const p = path.join(projectRoot, '.agentic-swe/procedures.json');
  if (!fs.existsSync(p)) return { procedures: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

module.exports = {
  seedCorpusProcedures,
  procedureFromScoring,
  findProcedureByVerify,
};
