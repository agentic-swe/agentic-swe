'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * @typedef {{ dir: string, name: string, mtimeMs: number }} ActiveCandidate
 */

/**
 * List non-completed work dirs under projectRoot/.worklogs with state.json mtime.
 * @param {string} projectRoot
 * @returns {ActiveCandidate[]}
 */
function listActiveCandidates(projectRoot) {
  const root = path.resolve(projectRoot, '.worklogs');
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const statePath = path.join(root, ent.name, 'state.json');
    if (!fs.existsSync(statePath)) continue;
    let state;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
      continue;
    }
    if (state.current_state === 'completed') continue;
    let st;
    try {
      st = fs.statSync(statePath);
    } catch {
      continue;
    }
    out.push({ dir: path.join(root, ent.name), name: ent.name, mtimeMs: st.mtimeMs });
  }
  return out;
}

/**
 * Deterministic pick: max mtime, then lexicographic by folder name.
 * @param {ActiveCandidate[]} candidates
 * @returns {{ workDir: string|null, tieAtMax: boolean, tiedNames: string[] }}
 */
function pickActiveFromCandidates(candidates) {
  if (!candidates.length) {
    return { workDir: null, tieAtMax: false, tiedNames: [] };
  }
  let maxM = 0;
  for (const c of candidates) {
    if (c.mtimeMs > maxM) maxM = c.mtimeMs;
  }
  const atMax = candidates.filter((c) => c.mtimeMs === maxM);
  atMax.sort((a, b) => a.name.localeCompare(b.name));
  const tieAtMax = atMax.length > 1;
  return {
    workDir: atMax[0].dir,
    tieAtMax,
    tiedNames: atMax.map((c) => c.name),
  };
}

/**
 * Pick the active work item: newest state.json mtime among non-completed; ties broken by work id name.
 * @param {string} projectRoot repo root (parent of .worklogs)
 * @returns {string|null} absolute path to .worklogs/<id> or null
 */
function discoverActiveWorkDir(projectRoot) {
  const c = listActiveCandidates(projectRoot);
  return pickActiveFromCandidates(c).workDir;
}

/**
 * Same as discoverActiveWorkDir plus tie metadata for warnings.
 * @param {string} projectRoot
 * @returns {{ workDir: string|null, activeCount: number, tieAtMax: boolean, tiedNames: string[], warning: string|null }}
 */
function discoverActiveWorkDirWithMeta(projectRoot) {
  const candidates = listActiveCandidates(projectRoot);
  const { workDir, tieAtMax, tiedNames } = pickActiveFromCandidates(candidates);
  let warning = null;
  if (tieAtMax && tiedNames.length > 1) {
    warning = `Multiple active work items share newest state.json mtime (${tiedNames.join(', ')}); using ${path.basename(workDir || '')} (lexicographic tie-break). Set AGENTIC_SWE_WORK_DIR to pin one item.`;
  }
  return {
    workDir,
    activeCount: candidates.length,
    tieAtMax,
    tiedNames,
    warning,
  };
}

module.exports = {
  discoverActiveWorkDir,
  discoverActiveWorkDirWithMeta,
  listActiveCandidates,
  pickActiveFromCandidates,
};
