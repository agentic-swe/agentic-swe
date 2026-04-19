'use strict';

const path = require('node:path');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('./config.cjs');
const {
  openOrCreateDatabase,
  clearGraphTables,
  clearChunkTables,
  persistDatabase,
  closeDatabase,
} = require('./graph-store.cjs');
const { ingestPackageManifests, ingestImportEdges } = require('./graph-ingest.cjs');
const { ingestChunksIntoDb } = require('./chunk-ingest.cjs');
const { syncChunkEmbeddings } = require('./chunk-embed.cjs');

/**
 * Full memory index: deterministic graph + chunked FTS (unless skipped).
 * @param {{ projectRoot: string, pluginRoot: string, skipGraph?: boolean, skipChunks?: boolean }} opts
 */
async function runMemoryIndex(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);

  const graphOff = merged.graph && merged.graph.enabled === false;
  const skipGraph = opts.skipGraph === true || graphOff;
  const skipChunks = opts.skipChunks === true;

  const { db } = await openOrCreateDatabase(sqlitePath);
  try {
    if (!skipGraph) {
      clearGraphTables(db);
      db.run('BEGIN');
      try {
        ingestPackageManifests(merged, projectRoot, db);
        ingestImportEdges(merged, projectRoot, db);
        db.run('COMMIT');
      } catch (e) {
        try {
          db.run('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      }
    }

    let chunkStats = { chunks: 0, embedded: 0 };
    if (!skipChunks) {
      clearChunkTables(db);
      const ing = ingestChunksIntoDb(merged, projectRoot, db);
      const embR = await syncChunkEmbeddings(db, merged);
      chunkStats = {
        chunks: ing.chunks,
        embedded: embR.embedded || 0,
        ...(embR.error ? { embedError: embR.error } : {}),
      };
    }

    const m1 = db.prepare('INSERT OR REPLACE INTO memory_meta (key, value) VALUES (?, ?)');
    m1.run(['last_ingest_at', new Date().toISOString()]);
    m1.free();
    const m2 = db.prepare('INSERT OR REPLACE INTO memory_meta (key, value) VALUES (?, ?)');
    m2.run(['last_ingest_root', projectRoot]);
    m2.free();

    let nodeCount = 0;
    let edgeCount = 0;
    if (!skipGraph) {
      const nRes = db.exec('SELECT COUNT(*) AS c FROM nodes');
      if (nRes[0] && nRes[0].values[0]) nodeCount = Number(nRes[0].values[0][0]);
      const eRes = db.exec('SELECT COUNT(*) AS c FROM edges');
      if (eRes[0] && eRes[0].values[0]) edgeCount = Number(eRes[0].values[0][0]);
    }

    persistDatabase(db, sqlitePath);

    return {
      sqlitePath,
      merged,
      graphSkipped: skipGraph,
      chunksSkipped: skipChunks,
      stats: {
        nodes: nodeCount,
        edges: edgeCount,
        chunks: chunkStats.chunks,
        embedded: chunkStats.embedded,
        ...(chunkStats.embedError ? { embedError: chunkStats.embedError } : {}),
      },
    };
  } finally {
    closeDatabase(db);
  }
}

module.exports = {
  runMemoryIndex,
};
