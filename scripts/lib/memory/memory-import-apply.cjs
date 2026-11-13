'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Ajv = require('ajv/dist/2020').default;
const {
  openOrCreateDatabase,
  persistDatabase,
  closeDatabase,
  upsertNodeRow,
  upsertEdgeRow,
} = require('./graph-store.cjs');
const { requireProvenance, buildIngestProvenance } = require('./provenance.cjs');
const { redactSecrets, redactDeep } = require('./session-capture.cjs');

/**
 * Resolve provenance for one imported node/edge.
 * Per-entry provenance wins; otherwise explicit legacy_import marks untrusted.
 * @param {object} entry
 * @param {object} bundle
 * @param {string} entryKind 'node'|'edge'
 * @param {string} entryKey stable id for hashing
 */
function resolveImportEntryProvenance(entry, bundle, entryKind, entryKey) {
  if (entry && entry.provenance != null) {
    return requireProvenance(entry);
  }
  const legacyFlag =
    bundle.legacy_import === true ||
    (bundle.provenance && bundle.provenance.legacy_import === true);
  if (!legacyFlag) {
    const err = new Error(
      `import ${entryKind} missing provenance (set per-entry provenance or legacy_import=true)`
    );
    err.code = 'MISSING_PROVENANCE';
    err.path = `${entryKind}.provenance`;
    throw err;
  }
  const source =
    bundle.provenance && bundle.provenance.source != null
      ? String(bundle.provenance.source).trim()
      : '';
  if (!source) {
    const err = new Error('legacy import requires bundle.provenance.source');
    err.code = 'MISSING_PROVENANCE';
    err.path = 'provenance.source';
    throw err;
  }
  const importedAt =
    (bundle.provenance && bundle.provenance.imported_at) || new Date().toISOString();
  const sourceHash = crypto.createHash('sha256').update(String(entryKey)).digest('hex');
  const provenance = buildIngestProvenance({
    source: 'memory-import:legacy',
    originPathOrEvent: `${source}:${entryKey}`,
    actor: 'system:memory-import:legacy',
    sourceHash,
    ingestedAt: importedAt,
  });
  return { ...provenance, legacy: true };
}

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

  for (const n of nodes) {
    const provenance = resolveImportEntryProvenance(n, bundle, 'node', String(n.id));
    const meta = n.meta && typeof n.meta === 'object' ? JSON.stringify(redactDeep(n.meta)) : null;
    upsertNodeRow(db, {
      id: n.id,
      kind: n.kind,
      path: n.path != null ? redactSecrets(String(n.path)).redacted : null,
      label: n.label != null ? redactSecrets(String(n.label)).redacted : null,
      metaJson: meta,
      recordJson: JSON.stringify({
        id: n.id,
        kind: n.kind,
        provenance,
        trust: 'untrusted',
        ...(provenance.legacy ? { legacy: true } : {}),
        redaction: { applied: true, ruleset: 'redact.cjs', hits: 0 },
      }),
    });
  }

  for (const e of edges) {
    const edgeKey = `${e.src_id}->${e.dst_id}:${e.kind}`;
    const provenance = resolveImportEntryProvenance(e, bundle, 'edge', edgeKey);
    const meta = e.meta && typeof e.meta === 'object' ? JSON.stringify(redactDeep(e.meta)) : null;
    upsertEdgeRow(db, {
      srcId: e.src_id,
      dstId: e.dst_id,
      kind: e.kind,
      metaJson: meta,
      recordJson: JSON.stringify({
        src_id: e.src_id,
        dst_id: e.dst_id,
        kind: e.kind,
        provenance,
        trust: 'untrusted',
        ...(provenance.legacy ? { legacy: true } : {}),
        redaction: { applied: true, ruleset: 'redact.cjs', hits: 0 },
      }),
    });
  }

  const prov = bundle.provenance || {};
  const metaRow = {
    last_import_source: prov.source,
    last_import_at: prov.imported_at || new Date().toISOString(),
    ...(prov.note ? { last_import_note: redactSecrets(String(prov.note)).redacted } : {}),
    ...(bundle.legacy_import === true || prov.legacy_import === true
      ? { legacy_import: true }
      : {}),
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
  } catch (err) {
    if (err && (err.code === 'MISSING_PROVENANCE' || err.code === 'MISSING_PROVENANCE_FIELD')) {
      return {
        ok: false,
        code: err.code,
        message: err.message,
        path: err.path,
      };
    }
    throw err;
  } finally {
    closeDatabase(db);
  }
}

module.exports = {
  applyImportBundleToDb,
  runMemoryImport,
  resolveImportEntryProvenance,
};
