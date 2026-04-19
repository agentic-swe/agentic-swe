'use strict';

const path = require('node:path');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('./config.cjs');
const { openOrCreateDatabase, closeDatabase } = require('./graph-store.cjs');
const {
  queryGraphStatsDb,
  queryTopNodesByDegreeDb,
  queryChunkCountDb,
  queryEmbeddingCountDb,
} = require('./graph-query.cjs');
const {
  resolveEmbeddingRuntime,
  embedText,
  cosineSimilarity,
} = require('./embeddings-backend.cjs');

/**
 * @param {string} q
 * @returns {string[]}
 */
function extractSearchTokens(q) {
  return String(q)
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((p) => p.length >= 2)
    .slice(0, 16);
}

/** @param {unknown} data */
function blobToFloat32(data) {
  if (!data) return new Float32Array(0);
  if (data instanceof Float32Array) return data;
  if (Buffer.isBuffer(data)) {
    const u8 = new Uint8Array(data);
    return new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength / 4);
  }
  if (data instanceof Uint8Array) {
    return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  }
  if (data instanceof ArrayBuffer) {
    return new Float32Array(data);
  }
  return new Float32Array(0);
}

/** @param {string} body @param {string[]} tokens @param {number} maxLen */
function snippetFromBody(body, tokens, maxLen) {
  const lower = body.toLowerCase();
  let idx = -1;
  for (const t of tokens) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0) {
      idx = i;
      break;
    }
  }
  if (idx < 0) {
    return body.length > maxLen ? `${body.slice(0, maxLen)}…` : body;
  }
  const start = Math.max(0, idx - 48);
  const slice = body.slice(start, start + maxLen);
  return `${start > 0 ? '…' : ''}${slice}${start + maxLen < body.length ? '…' : ''}`;
}

/**
 * Lexical search on `chunks` (sql.js has no FTS5 module — LIKE-based).
 * @param {*} db
 * @param {string[]} tokens
 * @param {number} limit
 * @param {string|null} workId
 */
function queryChunkHits(db, tokens, limit, workId) {
  if (!tokens.length) return [];
  const lim = Math.min(200, Math.max(1, Number(limit) || 12));
  let sql = 'SELECT chunk_id, path, start_line, end_line, body FROM chunks WHERE ';
  sql += tokens.map(() => 'lower(body) LIKE ?').join(' AND ');
  const params = tokens.map((t) => `%${t.toLowerCase()}%`);
  if (workId) {
    sql += ' AND work_id = ?';
    params.push(workId);
  }
  sql += ` LIMIT ${lim}`;

  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    const o = stmt.getAsObject();
    const b = o.body;
    o.snip = snippetFromBody(String(b || ''), tokens, 220);
    delete o.body;
    rows.push(o);
  }
  stmt.free();
  return rows;
}

/**
 * @param {*} db
 * @param {Float32Array} queryVec
 * @param {string} modelId
 * @param {number} limit
 * @param {string|null} workId
 * @param {number} maxScan
 * @param {string[]} tokens for snippets
 */
function queryChunkHitsSemantic(db, queryVec, modelId, limit, workId, maxScan, tokens) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 12));
  const scan = Math.min(50000, Math.max(1, Number(maxScan) || 8000));
  let sql = `SELECT e.chunk_id, e.vec, c.path, c.start_line, c.end_line, c.body
    FROM chunk_embeddings e INNER JOIN chunks c ON c.chunk_id = e.chunk_id
    WHERE e.model_id = ?`;
  const params = [modelId];
  if (workId) {
    sql += ' AND c.work_id = ?';
    params.push(workId);
  }
  sql += ` LIMIT ${scan}`;

  const stmt = db.prepare(sql);
  stmt.bind(params);
  const scored = [];
  while (stmt.step()) {
    const o = stmt.getAsObject();
    const vec = blobToFloat32(o.vec);
    delete o.vec;
    if (vec.length !== queryVec.length) continue;
    const sim = cosineSimilarity(queryVec, vec);
    const body = String(o.body || '');
    o.snip = snippetFromBody(body, tokens, 220);
    delete o.body;
    o._sim = sim;
    scored.push(o);
  }
  stmt.free();
  scored.sort((a, b) => (b._sim || 0) - (a._sim || 0));
  for (const o of scored) delete o._sim;
  return scored.slice(0, lim);
}

/**
 * Reciprocal rank fusion over two ranked lists (chunk_id).
 * @param {Array<{ chunk_id: string }>} lexHits
 * @param {Array<{ chunk_id: string }>} semHits
 * @param {number} k
 * @param {number} maxOut
 */
function rrfFuseChunkHits(lexHits, semHits, k, maxOut) {
  const kk = Math.min(200, Math.max(1, Number(k) || 60));
  const outN = Math.min(200, Math.max(1, Number(maxOut) || 12));
  const score = new Map();
  const byId = new Map();

  lexHits.forEach((h, rank) => {
    const id = h.chunk_id;
    score.set(id, (score.get(id) || 0) + 1 / (kk + rank + 1));
    byId.set(id, { ...h });
  });
  semHits.forEach((h, rank) => {
    const id = h.chunk_id;
    score.set(id, (score.get(id) || 0) + 1 / (kk + rank + 1));
    if (!byId.has(id)) byId.set(id, { ...h });
  });

  const ids = [...score.keys()].sort((a, b) => score.get(b) - score.get(a));
  return ids.slice(0, outN).map((id) => byId.get(id)).filter(Boolean);
}

/** @param {string} s @param {number} max */
function limitChars(s, max) {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 20))}\n\n… (truncated)`;
}

/**
 * @param {{ projectRoot: string, pluginRoot: string, query?: string|null, workId?: string|null }} opts
 * @returns {Promise<string>}
 */
async function buildPrimeMarkdown(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);

  const maxOut = merged.prime && merged.prime.max_chars_out ? merged.prime.max_chars_out : 12000;
  const maxHits = merged.prime && merged.prime.max_fts_hits ? merged.prime.max_fts_hits : 12;
  const retrievalMode = (merged.prime && merged.prime.retrieval_mode) || 'auto';
  const rrfK = merged.prime && merged.prime.rrf_k != null ? merged.prime.rrf_k : 60;
  const semScan =
    merged.prime && merged.prime.semantic_candidate_limit != null
      ? merged.prime.semantic_candidate_limit
      : 8000;
  const lexPool = Math.min(200, Math.max(maxHits, maxHits * 3));

  const { db } = await openOrCreateDatabase(sqlitePath);
  try {
    const lines = [];
    lines.push('## Memory prime (advisory)');
    lines.push('');
    lines.push(
      '**Source priority:** treat `state.json` and repository files as authoritative; this block is retrieved context only.'
    );
    lines.push('');

    const gs = queryGraphStatsDb(db);
    const chunkCount = queryChunkCountDb(db);
    const embCount = queryEmbeddingCountDb(db);
    lines.push('### Graph digest');
    lines.push(
      `- **Nodes:** ${gs.nodes}  **Edges:** ${gs.edges}  **Indexed chunks:** ${chunkCount}  **Embeddings rows:** ${embCount}`
    );
    if (gs.kinds && gs.kinds.nodes && Object.keys(gs.kinds.nodes).length) {
      lines.push(`- **Node kinds:** ${JSON.stringify(gs.kinds.nodes)}`);
    }
    if (gs.kinds && gs.kinds.edges && Object.keys(gs.kinds.edges).length) {
      lines.push(`- **Edge kinds:** ${JSON.stringify(gs.kinds.edges)}`);
    }

    const top = queryTopNodesByDegreeDb(db, 8);
    if (top.length) {
      lines.push('- **High-degree nodes:**');
      for (const r of top) {
        lines.push(`  - \`${r.id}\` (${r.kind}, deg ${r.deg}) ${r.label ? `— ${r.label}` : ''}`);
      }
    }
    lines.push('');

    const q = opts.query != null ? opts.query : null;
    const tokens = q ? extractSearchTokens(q) : [];
    if (tokens.length) {
      const rt = resolveEmbeddingRuntime(merged);
      let requested = String(retrievalMode).toLowerCase();
      if (
        requested !== 'lexical' &&
        requested !== 'semantic' &&
        requested !== 'hybrid' &&
        requested !== 'auto'
      ) {
        requested = 'auto';
      }
      let mode =
        requested === 'auto'
          ? embCount > 0 && rt
            ? 'hybrid'
            : 'lexical'
          : requested;

      if ((mode === 'semantic' || mode === 'hybrid') && (!rt || embCount === 0)) {
        const explicitFail = requested === 'semantic' || requested === 'hybrid';
        if (explicitFail) {
          lines.push(
            `_Retrieval mode \`${requested}\` needs embeddings enabled and indexed rows; falling back to lexical._`
          );
          lines.push('');
        }
        mode = 'lexical';
      }

      lines.push(`### Chunk search (${mode})`);
      lines.push(`- **Query:** ${JSON.stringify(q)}`);
      if (opts.workId) {
        lines.push(`- **Work id filter:** \`${opts.workId}\``);
      }
      lines.push('');

      try {
        let display = [];

        if (mode === 'lexical') {
          display = queryChunkHits(db, tokens, maxHits, opts.workId || null);
        } else {
          const qEmb = rt ? await embedText(String(q), rt) : null;
          if (!qEmb || !rt) {
            display = queryChunkHits(db, tokens, maxHits, opts.workId || null);
          } else if (mode === 'semantic') {
            display = queryChunkHitsSemantic(
              db,
              qEmb.vec,
              qEmb.modelId,
              maxHits,
              opts.workId || null,
              semScan,
              tokens
            );
          } else {
            const lex = queryChunkHits(db, tokens, lexPool, opts.workId || null);
            const sem = queryChunkHitsSemantic(
              db,
              qEmb.vec,
              qEmb.modelId,
              lexPool,
              opts.workId || null,
              semScan,
              tokens
            );
            display = rrfFuseChunkHits(lex, sem, rrfK, maxHits);
          }
        }

        if (display.length === 0) {
          lines.push('_No matching chunks._');
        } else {
          for (const h of display) {
            const ref = `${h.path}:${h.start_line}-${h.end_line}`;
            lines.push(`- **${ref}** — ${h.snip || ''}`);
          }
        }
      } catch (e) {
        lines.push(`_Chunk search failed: ${e && e.message ? e.message : String(e)}_`);
      }
      lines.push('');
    } else if (q) {
      lines.push('### Chunk search');
      lines.push('_Query produced no searchable tokens (use 2+ characters per term)._');
      lines.push('');
    }

    return limitChars(lines.join('\n'), maxOut);
  } finally {
    closeDatabase(db);
  }
}

module.exports = {
  buildPrimeMarkdown,
  extractSearchTokens,
  queryChunkHits,
  queryChunkHitsSemantic,
  rrfFuseChunkHits,
};
