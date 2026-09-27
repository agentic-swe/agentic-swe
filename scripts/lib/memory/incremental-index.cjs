'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('./config.cjs');
const { openOrCreateDatabase, persistDatabase, closeDatabase, ensureChunksSchema } = require('./graph-store.cjs');
const { chunkMarkdown, makeChunkId, workIdFromPath } = require('./chunk-split.cjs');
const { isPathIncluded } = require('./glob-match.cjs');
const { walkAllFiles, defaultChunkExtensions } = require('./chunk-ingest.cjs');

function watermarkPath(projectRoot) {
  return path.join(projectRoot, '.agentic-swe', 'index-watermark.json');
}

function readWatermark(projectRoot) {
  const file = watermarkPath(projectRoot);
  if (!fs.existsSync(file)) return { files: {} };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { files: data.files || {} };
  } catch {
    return { files: {} };
  }
}

function writeWatermark(projectRoot, watermark) {
  const file = watermarkPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ updated_at: new Date().toISOString(), files: watermark.files }, null, 2));
}

function chunkExtensions(merged) {
  if (typeof defaultChunkExtensions === 'function') return defaultChunkExtensions(merged);
  return ['.md'];
}

/**
 * Index only markdown files that changed since the last watermark.
 * The first run indexes the newest files up to `limit` and leaves the rest pending.
 * A full rebuild remains `npm run memory-index`.
 * @param {{ projectRoot: string, pluginRoot: string, limit?: number }} opts
 */
async function runIncrementalIndex(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot || projectRoot);
  const limit = Number(opts.limit || process.env.AGENTIC_SWE_INDEX_LIMIT || 24);
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);
  const watermark = readWatermark(projectRoot);
  const exts = chunkExtensions(merged);
  const include = (merged.ingest && merged.ingest.include_globs) || [];
  const exclude = (merged.ingest && merged.ingest.exclude_globs) || [];
  const maxBytes = merged.ingest && merged.ingest.max_file_bytes ? merged.ingest.max_file_bytes : 1048576;
  const maxChars = merged.ingest && merged.ingest.max_chunk_chars ? merged.ingest.max_chunk_chars : 8000;

  const all = [];
  walkAllFiles(projectRoot, projectRoot, all);
  const candidates = [];
  for (const rel of all) {
    if (!exts.some((ext) => rel.toLowerCase().endsWith(ext.toLowerCase()))) continue;
    if (!isPathIncluded(rel, include, exclude)) continue;
    const abs = path.join(projectRoot, ...rel.split('/'));
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (st.size > maxBytes) continue;
    const seen = watermark.files[rel];
    if (seen && Number(seen) === st.mtimeMs) continue;
    candidates.push({ rel, abs, mtimeMs: st.mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const batch = candidates.slice(0, limit);

  if (!batch.length) {
    return { ok: true, updated: 0, pending: 0, sqlitePath };
  }

  const { db } = await openOrCreateDatabase(sqlitePath);
  try {
    ensureChunksSchema(db);
    const del = db.prepare('DELETE FROM chunks WHERE path = ?');
    const ins = db.prepare(
      `INSERT OR REPLACE INTO chunks (chunk_id, path, work_id, start_line, end_line, content_sha256, body)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    let chunks = 0;
    for (const file of batch) {
      del.run([file.rel]);
      let text = '';
      try {
        text = fs.readFileSync(file.abs, 'utf8');
      } catch {
        continue;
      }
      const workId = workIdFromPath(file.rel);
      for (const piece of chunkMarkdown(text, maxChars)) {
        const cid = makeChunkId(file.rel, piece.startLine, piece.endLine, piece.body);
        const sha = crypto.createHash('sha256').update(piece.body, 'utf8').digest('hex');
        ins.run([cid, file.rel, workId, piece.startLine, piece.endLine, sha, piece.body]);
        chunks++;
      }
      watermark.files[file.rel] = file.mtimeMs;
    }
    del.free();
    ins.free();
    persistDatabase(db, sqlitePath);
    writeWatermark(projectRoot, watermark);
    return {
      ok: true,
      updated: batch.length,
      pending: Math.max(0, candidates.length - batch.length),
      chunks,
      sqlitePath,
    };
  } finally {
    closeDatabase(db);
  }
}

module.exports = {
  runIncrementalIndex,
};
