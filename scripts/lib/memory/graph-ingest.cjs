'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('./config.cjs');
const {
  openOrCreateDatabase,
  clearGraphTables,
  persistDatabase,
  closeDatabase,
} = require('./graph-store.cjs');
const {
  extractImportSpecifiers,
  classifyImport,
  resolveRelativeModuleFile,
  fileNodeId,
  npmNodeId,
  manifestNodeId,
  isCodeFile,
} = require('./import-extract.cjs');

const PROJECT_NODE_ID = 'project:root';

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
 * @param {string[]} out posix rel paths
 */
function walkPackageJsonFiles(root, projectRoot, out) {
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
      walkPackageJsonFiles(abs, projectRoot, out);
    } else if (ent.isFile() && ent.name === 'package.json') {
      const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
      out.push(rel);
    }
  }
}

/**
 * @param {string} root abs
 * @param {string} projectRoot abs
 * @param {string[]} out posix rel paths
 */
function walkCodeFiles(root, projectRoot, out) {
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
      walkCodeFiles(abs, projectRoot, out);
    } else if (ent.isFile() && isCodeFile(ent.name)) {
      const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
      out.push(rel);
    }
  }
}

/**
 * @param {import('sql.js').Database} db
 */
function insertNode(db, id, kind, relPath, label, meta) {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO nodes (id, kind, path, label, meta_json) VALUES (?, ?, ?, ?, ?)'
  );
  stmt.run([id, kind, relPath || null, label || null, meta != null ? JSON.stringify(meta) : null]);
  stmt.free();
}

/**
 * @param {import('sql.js').Database} db
 */
function insertEdge(db, src, dst, kind, meta) {
  const stmt = db.prepare(
    'INSERT OR REPLACE INTO edges (src_id, dst_id, kind, meta_json) VALUES (?, ?, ?, ?)'
  );
  stmt.run([src, dst, kind, meta != null ? JSON.stringify(meta) : null]);
  stmt.free();
}

/**
 * @param {object} merged config
 * @param {string} projectRoot abs
 * @param {import('sql.js').Database} db
 */
function ingestPackageManifests(merged, projectRoot, db) {
  const manifests = [];
  walkPackageJsonFiles(projectRoot, projectRoot, manifests);

  insertNode(db, PROJECT_NODE_ID, 'project', '', path.basename(projectRoot), {
    root: true,
  });

  const depKeys = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

  for (const rel of manifests) {
    const abs = path.join(projectRoot, ...rel.split('/'));
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch {
      continue;
    }
    const mid = manifestNodeId(rel);
    const label = typeof raw.name === 'string' ? raw.name : rel;
    insertNode(db, mid, 'manifest', rel, label, { version: raw.version });

    insertEdge(db, PROJECT_NODE_ID, mid, 'has_manifest', { path: rel });

    for (const dk of depKeys) {
      const block = raw[dk];
      if (!block || typeof block !== 'object') continue;
      for (const pkgName of Object.keys(block)) {
        const nid = npmNodeId(pkgName);
        insertNode(db, nid, 'npm', null, pkgName, null);
        insertEdge(db, mid, nid, 'depends_on', { section: dk });
      }
    }
  }
}

/**
 * @param {object} merged
 * @param {string} projectRoot
 * @param {import('sql.js').Database} db
 */
function ingestImportEdges(merged, projectRoot, db) {
  const maxBytes = merged.ingest && merged.ingest.max_file_bytes ? merged.ingest.max_file_bytes : 1048576;
  const files = [];
  walkCodeFiles(projectRoot, projectRoot, files);

  for (const rel of files) {
    const abs = path.join(projectRoot, ...rel.split('/'));
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      continue;
    }
    if (st.size > maxBytes) continue;

    let content;
    try {
      content = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }

    const fid = fileNodeId(rel);
    insertNode(db, fid, 'file', rel, path.basename(rel), { bytes: st.size });

    insertEdge(db, PROJECT_NODE_ID, fid, 'has_file', {});

    const specs = extractImportSpecifiers(content);
    for (const spec of specs) {
      const c = classifyImport(projectRoot, abs, spec);
      if (!c) continue;
      if (c.type === 'npm') {
        const nid = npmNodeId(c.name);
        insertNode(db, nid, 'npm', null, c.name, null);
        insertEdge(db, fid, nid, 'imports', { specifier: spec });
      } else if (c.type === 'relative') {
        const resolved = resolveRelativeModuleFile(projectRoot, abs, spec);
        if (resolved) {
          const tid = fileNodeId(resolved);
          insertNode(db, tid, 'file', resolved, path.basename(resolved), null);
          insertEdge(db, fid, tid, 'imports', { specifier: spec });
        }
      }
    }
  }
}

/**
 * @param {{ projectRoot: string, pluginRoot: string }} opts
 * @returns {Promise<{ sqlitePath: string, stats: { nodes: number, edges: number } }>}
 */
async function ingestGraphProject(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot);
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);

  if (merged.graph && merged.graph.enabled === false) {
    return { sqlitePath: sqlitePathForProject(merged, projectRoot), stats: { nodes: 0, edges: 0 }, skipped: true };
  }

  const sqlitePath = sqlitePathForProject(merged, projectRoot);
  const { db } = await openOrCreateDatabase(sqlitePath);
  try {
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

    const m1 = db.prepare('INSERT OR REPLACE INTO memory_meta (key, value) VALUES (?, ?)');
    m1.run(['last_ingest_at', new Date().toISOString()]);
    m1.free();
    const m2 = db.prepare('INSERT OR REPLACE INTO memory_meta (key, value) VALUES (?, ?)');
    m2.run(['last_ingest_root', projectRoot]);
    m2.free();

    let nodeCount = 0;
    let edgeCount = 0;
    const nRes = db.exec('SELECT COUNT(*) AS c FROM nodes');
    if (nRes[0] && nRes[0].values[0]) nodeCount = Number(nRes[0].values[0][0]);
    const eRes = db.exec('SELECT COUNT(*) AS c FROM edges');
    if (eRes[0] && eRes[0].values[0]) edgeCount = Number(eRes[0].values[0][0]);

    persistDatabase(db, sqlitePath);
    return { sqlitePath, stats: { nodes: nodeCount, edges: edgeCount } };
  } finally {
    closeDatabase(db);
  }
}

module.exports = {
  ingestGraphProject,
  ingestPackageManifests,
  ingestImportEdges,
  walkPackageJsonFiles,
  walkCodeFiles,
  PROJECT_NODE_ID,
};
