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
  const raw = String(absPath).replace(/\\/g, '/');
  // Keep POSIX or drive-letter absolutes as-is. path.resolve on Windows rewrites
  // '/Users/...' into 'C:/Users/...', which breaks Cursor-style slug fixtures.
  const resolved =
    raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)
      ? raw
      : path.resolve(absPath).replace(/\\/g, '/');
  const forDash = resolved.replace(/^\/+/, '');
  const dashed = forDash.split('/').join('-');
  const slashDash = resolved.replace(/\//g, '-');
  return [...new Set([dashed, `-${dashed}`, slashDash])];
}

/**
 * Host transcripts (~/.cursor, ~/.claude) are off unless the project opts in.
 * `opts.hostIngest` wins, then AGENTIC_SWE_HOST_TRANSCRIPTS, then transcripts.host_ingest
 * in the merged memory config. Explicit sources are unaffected.
 * @param {string} projectRoot
 * @param {{ hostIngest?: boolean, pluginRoot?: string }} opts
 */
function hostIngestEnabled(projectRoot, opts) {
  if (opts.hostIngest === true) return true;
  if (opts.hostIngest === false) return false;
  const env = process.env.AGENTIC_SWE_HOST_TRANSCRIPTS;
  if (env === '1' || /^true$/i.test(String(env || ''))) return true;
  if (env === '0' || /^false$/i.test(String(env || ''))) return false;
  try {
    const pluginRoot = opts.pluginRoot || path.resolve(__dirname, '..', '..', '..');
    const { loadMergedMemoryConfig } = require('./config.cjs');
    const cfg = loadMergedMemoryConfig(pluginRoot, projectRoot);
    return Boolean(cfg.transcripts && cfg.transcripts.host_ingest === true);
  } catch {
    return false;
  }
}

/**
 * Project-scoped chat directories.
 * Always: `<project>/.agentic-swe/sessions`, `opts.extraDirs`, and `AGENTIC_SWE_CHAT_DIRS`.
 * Host transcripts only when opted in, and only for this project directory (no ancestor walk).
 * `allHosts` also requires that opt-in; it then reads every project under the host roots.
 *
 * @param {string} projectRoot
 * @param {{ allHosts?: boolean, extraDirs?: string[], hostIngest?: boolean, pluginRoot?: string, homeDir?: string }} [opts]
 * @returns {{ dirs: string[], files: string[], scoped: boolean, host_ingest: boolean }}
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

  const resolved = path.resolve(projectRoot);
  addDir(path.join(resolved, '.agentic-swe', 'sessions'));

  for (const extra of opts.extraDirs || []) addDir(path.resolve(extra));

  const envDirs = String(process.env.AGENTIC_SWE_CHAT_DIRS || '')
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const d of envDirs) addDir(d);

  const hostIngest = hostIngestEnabled(resolved, opts);
  if (hostIngest) {
    const home = opts.homeDir || os.homedir();
    const cursorRoot = path.join(home, '.cursor', 'projects');
    const claudeRoot = path.join(home, '.claude', 'projects');
    if (opts.allHosts) {
      addDir(cursorRoot);
      addDir(claudeRoot);
    } else {
      for (const slug of projectFolderSlugs(resolved)) {
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

  return { dirs, files, scoped: !opts.allHosts, host_ingest: hostIngest };
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

module.exports = { projectFolderSlugs, hostIngestEnabled, discoverTranscriptSources, newestTranscriptFile };
