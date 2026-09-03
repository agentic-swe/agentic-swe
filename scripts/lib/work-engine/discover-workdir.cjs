'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * @typedef {{ dir: string, name: string, mtimeMs: number }} ActiveCandidate
 */

function readWorkState(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Prefer a .worklogs/<id> whose id matches the current git branch (or the suffix after work/feature/…).
 * Includes completed items so a follow-up session on the same branch still sees muscle memory.
 * @param {string} projectRoot
 * @returns {string|null}
 */
function readGitHeadBranch(projectRoot) {
  const root = path.resolve(projectRoot);
  const gitPath = path.join(root, '.git');
  if (!fs.existsSync(gitPath)) return null;
  let gitDir = gitPath;
  try {
    const st = fs.statSync(gitPath);
    if (st.isFile()) {
      const text = fs.readFileSync(gitPath, 'utf8');
      const m = text.match(/gitdir:\s*(.+)/i);
      if (!m) return null;
      gitDir = path.resolve(root, m[1].trim());
    }
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return ref ? ref[1] : null;
  } catch {
    return null;
  }
}

function workDirMatchingGitBranch(projectRoot) {
  const root = path.resolve(projectRoot);
  const branch = readGitHeadBranch(root);
  if (!branch || branch === 'HEAD' || branch === 'main' || branch === 'master') return null;
  const ids = [branch];
  const slash = branch.indexOf('/');
  if (slash > 0) ids.push(branch.slice(slash + 1));
  const seen = new Set();
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const dir = path.join(path.resolve(projectRoot), '.worklogs', id);
    if (readWorkState(dir)) return dir;
  }
  return null;
}

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
  const fromBranch = workDirMatchingGitBranch(projectRoot);
  if (fromBranch) return fromBranch;
  const c = listActiveCandidates(projectRoot);
  return pickActiveFromCandidates(c).workDir;
}

/**
 * Same as discoverActiveWorkDir plus tie metadata for warnings.
 * @param {string} projectRoot
 * @returns {{ workDir: string|null, activeCount: number, tieAtMax: boolean, tiedNames: string[], warning: string|null }}
 */
function discoverActiveWorkDirWithMeta(projectRoot) {
  const fromBranch = workDirMatchingGitBranch(projectRoot);
  if (fromBranch) {
    const candidates = listActiveCandidates(projectRoot);
    return {
      workDir: fromBranch,
      activeCount: Math.max(candidates.length, 1),
      tieAtMax: false,
      tiedNames: [],
      warning: null,
      matched_git_branch: true,
    };
  }
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
  workDirMatchingGitBranch,
  readGitHeadBranch,
};
