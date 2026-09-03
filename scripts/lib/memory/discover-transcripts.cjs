'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findJsonlFiles } = require('./session-ingest.cjs');

/**
 * Encode an absolute path the way Cursor / Claude Code name project folders.
 * @param {string} absPath
 * @returns {string[]}
 */
function projectFolderSlugs(absPath) {
  const resolved = path.resolve(absPath).replace(/\\/g, '/');
  const noLead = resolved.replace(/^\/+/, '');
  const dashed = noLead.split('/').join('-');
  const slashDash = resolved.replace(/\//g, '-');
  return [...new Set([dashed, `-${dashed}`, slashDash])];
}

/**
 * Walk projectRoot and ancestors (bounded) so a nested package still finds the workspace transcript dir.
 * @param {string} projectRoot
 * @returns {string[]}
 */
function ancestorRoots(projectRoot, max = 6) {
  const out = [];
  let cur = path.resolve(projectRoot);
  for (let i = 0; i < max; i++) {
    out.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return out;
}

/**
 * Project-scoped chat directories: local sessions, Cursor agent-transcripts, Claude projects.
 * Does not walk every host project unless opts.allHosts is true (cross-repo leak).
 *
 * @param {string} projectRoot
 * @param {{ allHosts?: boolean, extraDirs?: string[] }} [opts]
 * @returns {{ dirs: string[], files: string[], scoped: boolean }}
 */
function discoverTranscriptSources(projectRoot, opts = {}) {
  const dirs = [];
  const seen = new Set();

  function addDir(d) {
    if (!d || seen.has(d)) return;
    if (!fs.existsSync(d)) return;
    seen.add(d);
    dirs.push(d);
  }

  addDir(path.join(path.resolve(projectRoot), '.agentic-swe', 'sessions'));

  for (const extra of opts.extraDirs || []) addDir(path.resolve(extra));

  const envDirs = String(process.env.AGENTIC_SWE_CHAT_DIRS || '')
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const d of envDirs) addDir(d);

  const home = os.homedir();
  const cursorRoot = path.join(home, '.cursor', 'projects');
  const claudeRoot = path.join(home, '.claude', 'projects');

  if (opts.allHosts) {
    addDir(cursorRoot);
    addDir(claudeRoot);
  } else {
    for (const root of ancestorRoots(projectRoot)) {
      for (const slug of projectFolderSlugs(root)) {
        addDir(path.join(cursorRoot, slug, 'agent-transcripts'));
        addDir(path.join(cursorRoot, slug));
        addDir(path.join(claudeRoot, slug));
        addDir(path.join(claudeRoot, `-${slug}`));
      }
    }
  }

  const files = [];
  const seenFile = new Set();
  for (const d of dirs) {
    for (const f of findJsonlFiles(d)) {
      if (seenFile.has(f)) continue;
      seenFile.add(f);
      files.push(f);
    }
  }

  return { dirs, files, scoped: !opts.allHosts };
}

/**
 * Newest .jsonl among discovered project-scoped transcripts.
 * @param {string} projectRoot
 * @returns {string|null}
 */
function newestTranscriptFile(projectRoot, opts = {}) {
  const { files } = discoverTranscriptSources(projectRoot, opts);
  let best = null;
  let bestMt = 0;
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      if (st.mtimeMs > bestMt) {
        bestMt = st.mtimeMs;
        best = f;
      }
    } catch {
      /* skip */
    }
  }
  return best;
}

module.exports = { projectFolderSlugs, ancestorRoots, discoverTranscriptSources, newestTranscriptFile };
