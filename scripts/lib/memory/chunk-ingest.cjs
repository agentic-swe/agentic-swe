'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chunkMarkdown, makeChunkId, workIdFromPath } = require('./chunk-split.cjs');
const { isPathIncluded } = require('./glob-match.cjs');

function shouldSkipDir(name) {
  return (
    name === 'node_modules' ||
    name === 'dist' ||
    name === '.git' ||
    name === 'coverage' ||
    name === '.agentic-swe'
  );
}

/**
 * @param {string} root abs
 * @param {string} projectRoot abs
 * @param {string[]} out
 */
function walkAllFiles(root, projectRoot, out) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(root, ent.name);
    if (ent.isDirectory()) {
      if (shouldSkipDir(ent.name)) continue;
      walkAllFiles(abs, projectRoot, out);
    } else if (ent.isFile()) {
      const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
      out.push(rel);
    }
  }
}

function defaultChunkExtensions(merged) {
  const ing = merged.ingest || {};
  if (Array.isArray(ing.chunk_extensions) && ing.chunk_extensions.length > 0) {
    return ing.chunk_extensions;
  }
  return ['.md'];
}

function endsWithChunkExt(rel, exts) {
  const lower = rel.toLowerCase();
  return exts.some((e) => lower.endsWith(e.toLowerCase()));
}

/**
 * @param {object} merged
 * @param {string} projectRoot abs
 * @param {*} db
 * @returns {{ chunks: number }}
 */
function ingestChunksIntoDb(merged, projectRoot, db) {
  const maxBytes = merged.ingest && merged.ingest.max_file_bytes ? merged.ingest.max_file_bytes : 1048576;
  const maxChars = merged.ingest && merged.ingest.max_chunk_chars ? merged.ingest.max_chunk_chars : 8000;
  const include = (merged.ingest && merged.ingest.include_globs) || [];
  const exclude = (merged.ingest && merged.ingest.exclude_globs) || [];
  const exts = defaultChunkExtensions(merged);

  const all = [];
  walkAllFiles(projectRoot, projectRoot, all);

  const insChunk = db.prepare(
    `INSERT OR REPLACE INTO chunks (chunk_id, path, work_id, start_line, end_line, content_sha256, body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  let n = 0;
  for (const rel of all) {
    if (!endsWithChunkExt(rel, exts)) continue;
    if (!isPathIncluded(rel, include, exclude)) continue;

    const abs = path.join(projectRoot, ...rel.split('/'));
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (st.size > maxBytes) continue;

    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }

    const workId = workIdFromPath(rel);
    const pieces = chunkMarkdown(text, maxChars);

    for (const p of pieces) {
      const cid = makeChunkId(rel, p.startLine, p.endLine, p.body);
      const sha = crypto.createHash('sha256').update(p.body, 'utf8').digest('hex');
      insChunk.run([cid, rel, workId, p.startLine, p.endLine, sha, p.body]);
      n++;
    }
  }

  insChunk.free();

  return { chunks: n };
}

module.exports = {
  ingestChunksIntoDb,
  walkAllFiles,
};
