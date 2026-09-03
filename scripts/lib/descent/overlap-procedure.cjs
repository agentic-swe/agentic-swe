'use strict';

const { loadStore } = require('./promotion.cjs');
const path = require('node:path');

const TEAM_PROCEDURE_SOURCES = [
  'git-history',
  'transcript-tools',
  'organic-worklog',
  'validation-approved',
  'session-mine',
];

function procedureReadPaths(rec) {
  const out = [];
  for (const a of rec.procedure?.actions || []) {
    if (a.type === 'READ_FILE' && a.path) out.push(String(a.path).replace(/\\/g, '/'));
  }
  return out;
}

function procedureVerifyCommand(rec) {
  return rec.procedure?.verify?.[0]?.command || rec.procedure?.actions?.find((a) => a.type === 'RUN')?.command || null;
}

/**
 * Evaluated team-mined procedure whose reads overlap declared implementation files.
 * Lets implementation-entry skip LLM when design verify ≠ git/transcript/organic verify.
 *
 * @param {string} projectRoot
 * @param {string[]} declaredFiles
 * @param {{ sources?: string[] }} [opts]
 */
function findOverlappingEvaluatedProcedure(projectRoot, declaredFiles, opts = {}) {
  const sources = opts.sources || TEAM_PROCEDURE_SOURCES;
  const declared = new Set((declaredFiles || []).map((f) => String(f).replace(/\\/g, '/')));
  if (!declared.size) return null;
  let data;
  try {
    data = loadStore(projectRoot);
  } catch {
    return null;
  }
  let best = null;
  for (const rec of data.procedures || []) {
    if (rec.eval_status === 'unevaluated') continue;
    const src = rec.procedure?._meta?.source;
    if (src && sources.length && !sources.includes(src)) continue;
    const paths = procedureReadPaths(rec);
    if (!paths.some((p) => declared.has(p))) continue;
    if (!procedureVerifyCommand(rec)) continue;
    if (!best) best = rec;
    else if (rec.tier === 'L0' && best.tier !== 'L0') best = rec;
  }
  return best;
}

function procedureMatchedByDescent(storeRoot, descent) {
  if (!descent?.ok || !descent.fingerprint) return null;
  try {
    const data = loadStore(storeRoot);
    return (data.procedures || []).find((p) => p.fingerprint === descent.fingerprint) || null;
  } catch {
    return null;
  }
}

/**
 * Fingerprint ladder, then evaluated git/transcript overlap on declared files.
 * @param {{ projectRoot: string, pluginRoot: string, storeRoot?: string, verifyCommand: string, files: string[], cwd?: string, skipL2?: boolean, strictFingerprint?: boolean }} opts
 */
async function tryLadderThenOverlap(opts) {
  const { tryDescentLadderWithFallback } = require('./ladder.cjs');
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot || projectRoot);
  const storeRoot = path.resolve(opts.storeRoot || projectRoot);
  const files = opts.files || [];
  let descent = await tryDescentLadderWithFallback({
    projectRoot,
    pluginRoot,
    storeRoot,
    verifyCommand: opts.verifyCommand,
    files,
    cwd: opts.cwd,
    skipL2: opts.skipL2 === true,
    strictFingerprint: opts.strictFingerprint === true,
  });
  let overlap = procedureMatchedByDescent(storeRoot, descent);
  const l01 = descent.ok === true && (descent.tier === 'L0' || descent.tier === 'L1');
  let overlapRerun = false;
  if (!l01 && files.length) {
    overlap = findOverlappingEvaluatedProcedure(storeRoot, files);
    if (overlap) {
      overlapRerun = true;
      const ovVerify = procedureVerifyCommand(overlap);
      const ovFiles = procedureReadPaths(overlap);
      descent = await tryDescentLadderWithFallback({
        projectRoot,
        pluginRoot,
        storeRoot,
        verifyCommand: ovVerify,
        files: ovFiles.length ? ovFiles : files,
        fingerprint: overlap.fingerprint,
        cwd: opts.cwd,
        skipL2: opts.skipL2 === true,
        strictFingerprint: true,
      });
    }
  }
  const hit = descent.ok === true && (descent.tier === 'L0' || descent.tier === 'L1');
  return { descent, overlap: hit ? overlap : null, hit, overlap_rerun: overlapRerun };
}

module.exports = {
  TEAM_PROCEDURE_SOURCES,
  procedureReadPaths,
  procedureVerifyCommand,
  procedureMatchedByDescent,
  findOverlappingEvaluatedProcedure,
  tryLadderThenOverlap,
};
