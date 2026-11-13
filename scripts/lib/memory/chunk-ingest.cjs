'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chunkMarkdown, makeChunkId, workIdFromPath } = require('./chunk-split.cjs');
const { redactSecrets } = require('./session-capture.cjs');
const { isPathIncluded } = require('./glob-match.cjs');
const { upsertChunkRow, ensureRecordColumns } = require('./graph-store.cjs');
const { buildIngestProvenance } = require('./provenance.cjs');
const { mapLegacyWorkId } = require('./taxonomy.cjs');

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
  const ingestedAt = new Date().toISOString();

  const all = [];
  walkAllFiles(projectRoot, projectRoot, all);
  ensureRecordColumns(db);

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
    const scope = mapLegacyWorkId(workId);
    const pieces = chunkMarkdown(text, maxChars);

    for (const p of pieces) {
      const body = redactSecrets(p.body).redacted;
      const cid = makeChunkId(rel, p.startLine, p.endLine, body);
      const sha = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
      const provenance = buildIngestProvenance({
        source: 'chunk-ingest',
        originPathOrEvent: rel,
        actor: 'system:chunk-ingest',
        sourceHash: sha,
        ingestedAt,
      });
      upsertChunkRow(db, {
        chunkId: cid,
        path: rel,
        workId,
        scope,
        body,
        startLine: p.startLine,
        endLine: p.endLine,
        contentSha256: sha,
        recordJson: JSON.stringify({
          id: cid,
          scope,
          provenance,
          trust: 'untrusted',
          redaction: { applied: true, ruleset: 'redact.cjs', hits: 0 },
        }),
      });
      n++;
    }
  }

  return { chunks: n };
}

module.exports = {
  ingestChunksIntoDb,
  walkAllFiles,
  defaultChunkExtensions,
};
