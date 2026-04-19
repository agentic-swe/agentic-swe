'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020').default;
const { openOrCreateDatabase, persistDatabase, closeDatabase } = require('./graph-store.cjs');

/**
 * @param {object} bundle validated memory import bundle
 * @param {{ maxNodes: number, maxEdges: number }} caps
 */
function applyImportBundleToDb(db, bundle, caps) {
  const nodes = Array.isArray(bundle.nodes) ? bundle.nodes : [];
  const edges = Array.isArray(bundle.edges) ? bundle.edges : [];
  if (nodes.length > caps.maxNodes) {
    throw new Error(`import exceeds max_nodes: ${nodes.length} > ${caps.maxNodes}`);
  }
  if (edges.length > caps.maxEdges) {
    throw new Error(`import exceeds max_edges: ${edges.length} > ${caps.maxEdges}`);
  }

  const insN = db.prepare(
    `INSERT OR REPLACE INTO nodes (id, kind, path, label, meta_json) VALUES (?, ?, ?, ?, ?)`
  );
  for (const n of nodes) {
    const meta = n.meta && typeof n.meta === 'object' ? JSON.stringify(n.meta) : null;
    insN.run([
      n.id,
      n.kind,
      n.path != null ? String(n.path) : null,
      n.label != null ? String(n.label) : null,
      meta,
    ]);
  }
  insN.free();

  const insE = db.prepare(
    `INSERT OR REPLACE INTO edges (src_id, dst_id, kind, meta_json) VALUES (?, ?, ?, ?)`
  );
  for (const e of edges) {
    const meta = e.meta && typeof e.meta === 'object' ? JSON.stringify(e.meta) : null;
    insE.run([e.src_id, e.dst_id, e.kind, meta]);
  }
  insE.free();

  const prov = bundle.provenance || {};
  const metaRow = {
    last_import_source: prov.source,
    last_import_at: prov.imported_at || new Date().toISOString(),
    ...(prov.note ? { last_import_note: prov.note } : {}),
  };
  const m = db.prepare('INSERT OR REPLACE INTO memory_meta (key, value) VALUES (?, ?)');
  m.run(['last_graph_import', JSON.stringify(metaRow)]);
  m.free();
}

/**
 * @param {{ projectRoot: string, pluginRoot: string, bundle: object, merged: object }} opts
 */
async function runMemoryImport(opts) {
  const { loadMergedMemoryConfig, sqlitePathForProject } = require('./config.cjs');
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot);
  const merged = opts.merged || loadMergedMemoryConfig(pluginRoot, projectRoot);
  const ia = merged.import_adapter || {};
  if (ia.enabled === false && !opts.force) {
    return {
      ok: false,
      code: 'IMPORT_DISABLED',
      message:
        'import_adapter.enabled is false in merged memory config (pass force or set import_adapter.enabled)',
    };
  }

  const schemaPath = path.join(pluginRoot, 'schemas', 'memory-import-bundle.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(opts.bundle)) {
    const msg = validate.errors ? JSON.stringify(validate.errors, null, 2) : 'validation failed';
    return { ok: false, code: 'INVALID_BUNDLE', message: msg };
  }

  const maxNodes = ia.max_nodes_per_merge != null ? Number(ia.max_nodes_per_merge) : 5000;
  const maxEdges = ia.max_edges_per_merge != null ? Number(ia.max_edges_per_merge) : 20000;
  const sqlitePath = sqlitePathForProject(merged, projectRoot);

  const { db } = await openOrCreateDatabase(sqlitePath);
  try {
    applyImportBundleToDb(db, opts.bundle, { maxNodes, maxEdges });
    persistDatabase(db, sqlitePath);
    return {
      ok: true,
      sqlitePath,
      stats: {
        nodes: opts.bundle.nodes.length,
        edges: opts.bundle.edges.length,
      },
    };
  } finally {
    closeDatabase(db);
  }
}

module.exports = {
  applyImportBundleToDb,
  runMemoryImport,
};
