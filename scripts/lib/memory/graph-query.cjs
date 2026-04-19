'use strict';

const { openOrCreateDatabase, closeDatabase } = require('./graph-store.cjs');

/**
 * @param {string} sqlitePath
 * @returns {Promise<{ nodes: number, edges: number, kinds: { nodes: Record<string, number>, edges: Record<string, number> } }>}
 */
/** @param {*} db */
function queryGraphStatsDb(db) {
  const nodes = db.exec('SELECT COUNT(*) AS c FROM nodes');
  const edges = db.exec('SELECT COUNT(*) AS c FROM edges');
  const nk = db.exec('SELECT kind, COUNT(*) AS c FROM nodes GROUP BY kind');
  const ek = db.exec('SELECT kind, COUNT(*) AS c FROM edges GROUP BY kind');

  const nodeCount = nodes[0] && nodes[0].values[0] ? Number(nodes[0].values[0][0]) : 0;
  const edgeCount = edges[0] && edges[0].values[0] ? Number(edges[0].values[0][0]) : 0;

  const nodeKinds = {};
  if (nk[0]) {
    for (const row of nk[0].values) {
      nodeKinds[row[0]] = Number(row[1]);
    }
  }
  const edgeKinds = {};
  if (ek[0]) {
    for (const row of ek[0].values) {
      edgeKinds[row[0]] = Number(row[1]);
    }
  }

  return {
    nodes: nodeCount,
    edges: edgeCount,
    kinds: { nodes: nodeKinds, edges: edgeKinds },
  };
}

async function queryGraphStats(sqlitePath) {
  const { db } = await openOrCreateDatabase(sqlitePath);
  try {
    return queryGraphStatsDb(db);
  } finally {
    closeDatabase(db);
  }
}

/**
 * Top-N nodes by total degree (in+out), for compact digests.
 * @param {string} sqlitePath
 * @param {number} [limit]
 */
/** @param {*} db */
function queryTopNodesByDegreeDb(db, limit = 12) {
  const lim = Math.min(500, Math.max(1, Number(limit) || 12));
  const res = db.exec(
    `SELECT id, kind, COALESCE(label, '') AS label,
     (SELECT COUNT(*) FROM edges e WHERE e.src_id = n.id OR e.dst_id = n.id) AS deg
     FROM nodes n
     ORDER BY deg DESC
     LIMIT ${lim}`
  );
  if (!res[0]) return [];
  const cols = res[0].columns;
  return res[0].values.map((row) => {
    const o = {};
    cols.forEach((c, i) => {
      o[c] = row[i];
    });
    return o;
  });
}

async function queryTopNodesByDegree(sqlitePath, limit = 12) {
  const { db } = await openOrCreateDatabase(sqlitePath);
  try {
    return queryTopNodesByDegreeDb(db, limit);
  } finally {
    closeDatabase(db);
  }
}

/** @param {*} db */
function queryChunkCountDb(db) {
  try {
    const r = db.exec('SELECT COUNT(*) AS c FROM chunks');
    if (r[0] && r[0].values[0]) return Number(r[0].values[0][0]);
  } catch {
    /* no chunks table */
  }
  return 0;
}

/** @param {*} db */
function queryEmbeddingCountDb(db) {
  try {
    const r = db.exec('SELECT COUNT(*) AS c FROM chunk_embeddings');
    if (r[0] && r[0].values[0]) return Number(r[0].values[0][0]);
  } catch {
    /* no table */
  }
  return 0;
}

module.exports = {
  queryGraphStats,
  queryGraphStatsDb,
  queryTopNodesByDegree,
  queryTopNodesByDegreeDb,
  queryChunkCountDb,
  queryEmbeddingCountDb,
};
