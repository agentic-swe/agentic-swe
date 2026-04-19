'use strict';

const { resolveEmbeddingRuntime, embedText } = require('./embeddings-backend.cjs');

/**
 * Embed chunks that are missing or stale for the active embedding model.
 * @param {*} db sql.js
 * @param {object} merged
 * @returns {Promise<{ embedded: number, skipped?: boolean, error?: string }>}
 */
async function syncChunkEmbeddings(db, merged) {
  const rt = resolveEmbeddingRuntime(merged);
  if (!rt) {
    return { embedded: 0, skipped: true };
  }

  try {
    const del = db.prepare('DELETE FROM chunk_embeddings WHERE model_id != ?');
    del.run([rt.modelId]);
    del.free();

    const sel = db.prepare(
      `SELECT c.chunk_id, c.content_sha256, c.body FROM chunks c
       LEFT JOIN chunk_embeddings e ON e.chunk_id = c.chunk_id AND e.model_id = ?
       WHERE e.chunk_id IS NULL OR e.content_sha256 != c.content_sha256`
    );
    sel.bind([rt.modelId]);

    const ins = db.prepare(
      `INSERT OR REPLACE INTO chunk_embeddings (chunk_id, model_id, dim, content_sha256, vec)
       VALUES (?, ?, ?, ?, ?)`
    );

    let n = 0;
    while (sel.step()) {
      const row = sel.getAsObject();
      const cid = row.chunk_id;
      const sha = row.content_sha256;
      const body = String(row.body || '');
      const emb = await embedText(body, rt);
      if (!emb) continue;
      const buf = Buffer.from(emb.vec.buffer, emb.vec.byteOffset, emb.vec.byteLength);
      ins.run([cid, emb.modelId, emb.dim, sha, buf]);
      n++;
    }
    sel.free();
    ins.free();

    return { embedded: n };
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    return { embedded: 0, skipped: false, error: msg };
  }
}

module.exports = {
  syncChunkEmbeddings,
};
