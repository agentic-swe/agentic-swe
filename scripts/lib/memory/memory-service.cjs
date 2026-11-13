'use strict';

/**
 * AE-030b/e/c/d — MemoryService write/read/delete seam + six-scope router.
 * Store-agnostic: callers depend on this API; default adapter is node:sqlite (ADR-004b).
 * AE-030c: provenance required on write; retrieve returns untrusted envelopes (ADR-012 / SEC-005).
 * AE-030d: delete+tombstone, TTL dry-run, PD-46 visibility/tenant defaults.
 * NB7: ingest/prime enter through this seam (withProjectDb / writeIngestChunkToDb);
 * provenance-checked graph-store helpers remain the only write primitives underneath
 * the adapter. Refs ADR-004b, ADR-012, ADR-016; PD-46/PD-47/PD-48 C3 (regex redact.cjs only).
 */

const crypto = require('node:crypto');
const path = require('node:path');
const {
  MEMORY_SCOPES,
  DEFAULT_TENANT_ID,
  DEFAULT_TRUST,
  mapLegacyWorkId,
  defaultRetentionClassForScope,
} = require('./taxonomy.cjs');
const { personalRoot } = require('./scopes.cjs');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('./config.cjs');
const { createNodeSqliteMemoryStore } = require('./adapters/node-sqlite-memory-store.cjs');
const { upsertChunkRow, ensureRecordColumns } = require('./graph-store.cjs');
const { redactSecrets } = require('../shared/redact.cjs');
const {
  ttlDryRun,
  defaultVisibilityForScope,
  resolveTenantLabel,
  evaluateExpiry,
} = require('./memory-retention.cjs');
const { requireProvenance } = require('./provenance.cjs');

const GIT_HISTORY_PATH_PREFIX = '.agentic-swe/sync/git/';
const TRUST_VALUES = new Set(['untrusted', 'reviewed', 'human_approved']);
const RETENTION_VALUES = new Set([
  'session',
  'execution_procedures',
  'organizational',
  'evaluation_negative',
]);
const VISIBILITY_VALUES = new Set(['private', 'local', 'public']);

/**
 * Fail closed: unknown MemoryRecord.scope must not default to a broader scope.
 * @param {string} scope
 * @returns {(typeof MEMORY_SCOPES)[number]}
 */
function assertKnownScope(scope) {
  const key = String(scope || '').trim();
  if (!MEMORY_SCOPES.includes(key)) {
    const err = new Error(`unknown memory scope: ${key || '(empty)'}`);
    err.code = 'UNKNOWN_MEMORY_SCOPE';
    err.path = 'scope';
    throw err;
  }
  return /** @type {(typeof MEMORY_SCOPES)[number]} */ (key);
}

/**
 * AE-030a residual: git-history ingest still stamps work_id=team but belongs
 * under repository. Detected by path prefix — no in-place rewrite of historical rows.
 * @param {{ work_id?: string|null, path?: string, scope?: string|null }} row
 * @returns {(typeof MEMORY_SCOPES)[number]}
 */
function resolveScopeAtSeam(row) {
  const storedScope = row.scope != null && String(row.scope).trim() !== ''
    ? String(row.scope).trim()
    : null;
  if (storedScope) {
    // New writes stamp scope; still re-check git-history residual if mis-stamped.
    if (
      storedScope === 'organizational' &&
      isGitHistoryPath(row.path) &&
      String(row.work_id || '').trim() === 'team'
    ) {
      return 'repository';
    }
    if (MEMORY_SCOPES.includes(storedScope)) {
      return /** @type {(typeof MEMORY_SCOPES)[number]} */ (storedScope);
    }
  }
  const workId = row.work_id;
  if (String(workId || '').trim() === 'team' && isGitHistoryPath(row.path)) {
    return 'repository';
  }
  return mapLegacyWorkId(workId);
}

/**
 * @param {string|null|undefined} p
 */
function isGitHistoryPath(p) {
  const rel = String(p || '').split(path.sep).join('/');
  return rel.startsWith(GIT_HISTORY_PATH_PREFIX);
}

/**
 * Reverse map: MemoryRecord.scope → legacy work_id stamp for chunks table.
 * @param {string} scope
 * @param {{ workId?: string|null, sessionId?: string|null, projectId?: string|null }} [opts]
 */
function workIdForScope(scope, opts = {}) {
  assertKnownScope(scope);
  if (scope === 'execution') {
    if (opts.sessionId) return `session:${opts.sessionId}`;
    if (opts.workId && String(opts.workId).startsWith('work:')) return String(opts.workId);
    if (opts.workId && String(opts.workId).startsWith('session:')) return String(opts.workId);
    return opts.workId ? String(opts.workId) : 'session';
  }
  if (scope === 'repository') {
    return null;
  }
  if (scope === 'project') {
    return opts.projectId || opts.workId || 'project';
  }
  if (scope === 'skill') {
    return 'personal';
  }
  if (scope === 'organizational') {
    return 'team';
  }
  if (scope === 'evaluation') {
    return opts.workId && String(opts.workId).startsWith('evaluation')
      ? String(opts.workId)
      : 'evaluation';
  }
  const err = new Error(`unknown memory scope: ${scope}`);
  err.code = 'UNKNOWN_MEMORY_SCOPE';
  err.path = 'scope';
  throw err;
}

/**
 * Which sqlite file holds a scope. Personal/skill → personalRoot() only.
 * @param {string} scope
 * @param {{ pluginRoot: string, projectRoot: string }} roots
 */
function sqlitePathForMemoryScope(scope, roots) {
  assertKnownScope(scope);
  if (scope === 'skill') {
    return path.join(personalRoot(), 'memory.sqlite');
  }
  const pluginRoot = path.resolve(roots.pluginRoot);
  const projectRoot = path.resolve(roots.projectRoot);
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  return sqlitePathForProject(merged, projectRoot);
}

/**
 * SEC-005 / ADR-012 A3 — retrieval envelope. Always trust=untrusted so callers
 * never concatenate body into system/developer instructions as trusted content.
 * @param {object} record MemoryRecord-shaped
 * @param {{ path?: string }} [opts]
 */
function toUntrustedEnvelope(record, opts = {}) {
  const provenance = record && record.provenance && typeof record.provenance === 'object'
    ? record.provenance
    : {};
  return {
    trust: 'untrusted',
    body: String(record && record.body != null ? record.body : ''),
    citation: {
      id: record && record.id != null ? String(record.id) : '',
      scope: record && record.scope != null ? String(record.scope) : '',
      origin: provenance.origin != null ? String(provenance.origin) : '',
      stored_trust: record && record.trust != null ? String(record.trust) : DEFAULT_TRUST,
      ...(opts.path ? { path: String(opts.path) } : {}),
      ...(provenance.source_uri
        ? { source_uri: String(provenance.source_uri) }
        : {}),
    },
    provenance: {
      origin: provenance.origin != null ? String(provenance.origin) : '',
      actor: provenance.actor != null ? String(provenance.actor) : '',
      source_hash: provenance.source_hash != null ? String(provenance.source_hash) : '',
      ingested_at: provenance.ingested_at != null ? String(provenance.ingested_at) : '',
      ...(provenance.source_uri
        ? { source_uri: String(provenance.source_uri) }
        : {}),
    },
    redaction: record && record.redaction && typeof record.redaction === 'object'
      ? record.redaction
      : { applied: true, ruleset: 'redact.cjs', hits: 0 },
    scope: record && record.scope != null ? String(record.scope) : '',
    tenant_id: record && record.tenant_id != null ? String(record.tenant_id) : DEFAULT_TENANT_ID,
  };
}

/**
 * Refuse treating an envelope body as trusted system/developer instructions.
 * @param {object} envelope
 * @returns {never}
 */
function refuseTrustedInstructionConcatenation(envelope) {
  const err = new Error(
    'recalled memory must not be concatenated into system/developer instructions (SEC-005)'
  );
  err.code = 'UNTRUSTED_MEMORY_NOT_INSTRUCTIONS';
  err.trust = envelope && envelope.trust;
  throw err;
}

/**
 * @param {object} input
 */
function normalizeWriteRecord(input) {
  const scope = assertKnownScope(input.scope);
  const bodyRaw = input.body == null ? '' : String(input.body);
  const redacted = redactSecrets(bodyRaw);
  const provenance = requireProvenance(input);

  const trust = input.trust != null ? String(input.trust) : DEFAULT_TRUST;
  if (!TRUST_VALUES.has(trust)) {
    const err = new Error(`unknown trust: ${trust}`);
    err.code = 'UNKNOWN_TRUST';
    err.path = 'trust';
    throw err;
  }

  const retention_class =
    input.retention_class != null
      ? String(input.retention_class)
      : defaultRetentionClassForScope(scope, {
          negativeEval: Boolean(input.negativeEval),
        });
  if (!RETENTION_VALUES.has(retention_class)) {
    const err = new Error(`unknown retention_class: ${retention_class}`);
    err.code = 'UNKNOWN_RETENTION_CLASS';
    err.path = 'retention_class';
    throw err;
  }

  const redaction =
    input.redaction && typeof input.redaction === 'object'
      ? {
          applied: Boolean(input.redaction.applied) || redacted.hits > 0,
          ruleset: String(input.redaction.ruleset || 'redact.cjs'),
          hits: Number.isFinite(Number(input.redaction.hits))
            ? Number(input.redaction.hits)
            : redacted.hits,
        }
      : {
          applied: redacted.hits > 0 || true,
          ruleset: 'redact.cjs',
          hits: redacted.hits,
        };
  // Always mark applied=true on write path (ADR-012 redact-on-write).
  redaction.applied = true;
  if (!Number.isFinite(redaction.hits) || redaction.hits < 0) {
    redaction.hits = redacted.hits;
  }

  const visibility = defaultVisibilityForScope(scope, input.visibility);
  if (!VISIBILITY_VALUES.has(visibility)) {
    const err = new Error(`unknown visibility: ${visibility}`);
    err.code = 'UNKNOWN_VISIBILITY';
    err.path = 'visibility';
    throw err;
  }
  // PD-46: org stays private/local; public without governed path is forbidden later at publish.
  if (scope === 'organizational' && visibility === 'public') {
    const err = new Error(
      'organizational memory cannot be written as public without AE-036/governed path'
    );
    err.code = 'ORG_MEMORY_PUBLIC_FORBIDDEN';
    err.path = 'visibility';
    throw err;
  }

  const id =
    input.id != null && String(input.id).trim() !== ''
      ? String(input.id)
      : `mem:${scope}:${crypto.randomBytes(8).toString('hex')}`;

  return {
    id,
    tenant_id: resolveTenantLabel(scope, input.tenant_id, DEFAULT_TENANT_ID),
    scope,
    body: redacted.redacted,
    provenance: {
      origin: String(provenance.origin),
      actor: String(provenance.actor),
      source_hash: String(provenance.source_hash),
      ingested_at: String(provenance.ingested_at),
      ...(provenance.source_uri
        ? { source_uri: String(provenance.source_uri) }
        : {}),
    },
    trust,
    retention_class,
    redaction,
    visibility,
    expires_at: input.expires_at === undefined ? undefined : input.expires_at,
  };
}

/**
 * NB7 — ingest chunk write through the MemoryService seam.
 * Fail-closed on unknown scope; provenance checked by upsertChunkRow underneath.
 * Used by chunk/session/incremental ingest that already hold a project db handle
 * (from withProjectDb / pipeline). Do not call upsertChunkRow from those modules.
 * @param {*} db
 * @param {{
 *   chunkId: string,
 *   path: string,
 *   workId: string|null,
 *   scope: string,
 *   body: string,
 *   startLine?: number,
 *   endLine?: number,
 *   contentSha256?: string,
 *   recordJson: string,
 * }} row
 */
function writeIngestChunkToDb(db, row) {
  const scope = assertKnownScope(row && row.scope);
  ensureRecordColumns(db);
  return upsertChunkRow(db, { ...row, scope });
}

/**
 * @param {object} row adapter chunk row
 */
function rowToMemoryRecord(row) {
  const scope = resolveScopeAtSeam(row);
  let parsed = null;
  if (row.record_json) {
    try {
      parsed = JSON.parse(String(row.record_json));
    } catch {
      parsed = null;
    }
  }
  const body = String(row.body || '');
  const base = {
    id: (parsed && parsed.id) || String(row.chunk_id || ''),
    tenant_id: (parsed && parsed.tenant_id) || DEFAULT_TENANT_ID,
    scope,
    body,
    provenance: (parsed && parsed.provenance) || {
      origin: 'legacy-chunk',
      actor: 'system',
      source_hash: String(row.content_sha256 || ''),
      ingested_at: '1970-01-01T00:00:00.000Z',
    },
    trust: (parsed && parsed.trust) || DEFAULT_TRUST,
    retention_class:
      (parsed && parsed.retention_class) || defaultRetentionClassForScope(scope),
    redaction: (parsed && parsed.redaction) || {
      applied: true,
      ruleset: 'redact.cjs',
      hits: 0,
    },
    visibility: (parsed && parsed.visibility) || 'private',
  };
  if (parsed && parsed.expires_at !== undefined) {
    base.expires_at = parsed.expires_at;
  }
  return base;
}

/**
 * @param {{
 *   pluginRoot: string,
 *   projectRoot: string,
 *   createStore?: Function,
 * }} opts
 */
function createMemoryService(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot);
  const createStore = opts.createStore || createNodeSqliteMemoryStore;

  /** @type {Map<string, ReturnType<typeof createNodeSqliteMemoryStore>>} */
  const stores = new Map();

  function storeForPath(sqlitePath) {
    const key = path.resolve(sqlitePath);
    let store = stores.get(key);
    if (!store) {
      store = createStore({ sqlitePath: key });
      stores.set(key, store);
    }
    return store;
  }

  /**
   * Write a MemoryRecord through the seam.
   * @param {object} input
   * @param {{ sessionId?: string, workId?: string, projectId?: string, path?: string }} [writeOpts]
   */
  async function write(input, writeOpts = {}) {
    const record = normalizeWriteRecord(input);
    const sqlitePath = sqlitePathForMemoryScope(record.scope, {
      pluginRoot,
      projectRoot,
    });
    // Personal / skill data must never land on the project sqlite.
    if (record.scope === 'skill') {
      const expected = path.join(path.resolve(personalRoot()), 'memory.sqlite');
      if (path.resolve(sqlitePath) !== expected) {
        const err = new Error('skill scope must use personalRoot() only');
        err.code = 'PERSONAL_ROOT_VIOLATION';
        err.path = 'sqlitePath';
        throw err;
      }
    }

    const workId = workIdForScope(record.scope, {
      sessionId: writeOpts.sessionId,
      workId: writeOpts.workId,
      projectId: writeOpts.projectId,
    });

    let recordPath = writeOpts.path;
    if (!recordPath) {
      if (record.scope === 'repository') {
        recordPath = `.agentic-swe/memory/repository/${record.id}.md`;
      } else if (record.scope === 'organizational') {
        recordPath = `.agentic-swe/sync/events/${record.id}.json`;
      } else if (record.scope === 'execution') {
        recordPath = `.agentic-swe/sessions/${record.id}.md`;
      } else if (record.scope === 'skill') {
        recordPath = `personal/${record.id}.md`;
      } else if (record.scope === 'evaluation') {
        recordPath = `.agentic-swe/eval/${record.id}.md`;
      } else {
        recordPath = `.agentic-swe/memory/project/${record.id}.md`;
      }
    }

    const store = storeForPath(sqlitePath);
    const recordJson = JSON.stringify({
      id: record.id,
      tenant_id: record.tenant_id,
      scope: record.scope,
      provenance: record.provenance,
      trust: record.trust,
      retention_class: record.retention_class,
      redaction: record.redaction,
      visibility: record.visibility,
      ...(record.expires_at !== undefined ? { expires_at: record.expires_at } : {}),
    });

    const result = await store.upsertChunk({
      chunkId: record.id,
      path: recordPath,
      workId,
      scope: record.scope,
      body: record.body,
      recordJson,
    });
    await store.persist();
    return {
      ...record,
      chunk_id: result.chunkId,
      content_sha256: result.contentSha256,
      sqlitePath,
      work_id: workId,
    };
  }

  /**
   * Read MemoryRecords for a scope. Isolation is enforced here (not at SQL alone).
   * @param {{
   *   scope: string,
   *   query?: string,
   *   limit?: number,
   * }} query
   */
  async function read(query) {
    const scope = assertKnownScope(query.scope);
    const limit = Math.min(500, Math.max(1, Number(query.limit) || 50));
    const sqlitePath = sqlitePathForMemoryScope(scope, { pluginRoot, projectRoot });
    const store = storeForPath(sqlitePath);
    await store.open();
    const rows = await store.listChunks({ limit: 5000 });
    const tombs = typeof store.listTombstones === 'function'
      ? await store.listTombstones({ limit: 5000 })
      : [];
    const tombIds = new Set(
      tombs.map((t) => String(t.chunk_id || '')).filter(Boolean)
    );
    const tokens = String(query.query || '')
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const out = [];
    for (const row of rows) {
      if (tombIds.has(String(row.chunk_id || ''))) continue;
      const resolved = resolveScopeAtSeam(row);
      if (resolved !== scope) continue;
      if (tokens.length) {
        const body = String(row.body || '').toLowerCase();
        if (!tokens.every((t) => body.includes(t))) continue;
      }
      out.push(rowToMemoryRecord(row));
      if (out.length >= limit) break;
    }
    const envelopes = out.map((rec) => toUntrustedEnvelope(rec));
    return {
      scope,
      sqlitePath,
      records: out,
      envelopes,
    };
  }

  /**
   * AE-030d — soft-delete by selector; writes tombstones; subsequent prime/read miss ids.
   * @param {{
   *   id?: string,
   *   ids?: string[],
   *   path?: string,
   *   scope?: string,
   * }} selector
   */
  async function deleteRecords(selector = {}) {
    const ids = [];
    if (selector.id) ids.push(String(selector.id));
    if (Array.isArray(selector.ids)) {
      for (const id of selector.ids) ids.push(String(id));
    }
    if (!ids.length && !selector.path && !selector.scope) {
      const err = new Error('delete selector requires id, ids, path, or scope');
      err.code = 'DELETE_SELECTOR_REQUIRED';
      err.path = 'selector';
      throw err;
    }

    let scopeHint = selector.scope;
    if (!scopeHint && ids.length) {
      // Default to organizational for id-only deletes unless caller sets scope.
      scopeHint = 'organizational';
    }
    if (scopeHint) assertKnownScope(scopeHint);

    const scopesToTouch = scopeHint
      ? [scopeHint]
      : [...MEMORY_SCOPES];

    const deleted = [];
    for (const scope of scopesToTouch) {
      const sqlitePath = sqlitePathForMemoryScope(scope, { pluginRoot, projectRoot });
      const store = storeForPath(sqlitePath);
      if (typeof store.deleteChunks !== 'function') continue;
      const result = await store.deleteChunks({
        ids: ids.length ? ids : undefined,
        path: selector.path,
        scope: ids.length || selector.path ? undefined : scope,
        selector,
      });
      deleted.push(...(result.deleted || []));
      await store.persist();
      if (ids.length && deleted.length >= ids.length) break;
      if (selector.path && result.count > 0) break;
    }
    return { deleted: [...new Set(deleted)], count: new Set(deleted).size };
  }

  /**
   * TTL dry-run for a scope (or provided records). No network.
   * @param {{ scope?: string, records?: object[], now?: string|number|Date }} opts
   */
  async function retentionDryRun(opts = {}) {
    let records = opts.records;
    if (!records) {
      const scope = assertKnownScope(opts.scope || 'organizational');
      const result = await read({ scope, limit: 5000 });
      records = result.records;
    }
    return ttlDryRun(records, { now: opts.now });
  }

  /**
   * NB7 — open the project sqlite via the adapter and run `fn(db, ctx)`.
   * Prefer this over requiring graph-store open/close from ingest/prime.
   * @param {(db: *, ctx: { sqlitePath: string, store: object }) => (any|Promise<any>)} fn
   */
  async function withProjectDb(fn) {
    const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
    const sqlitePath = sqlitePathForProject(merged, projectRoot);
    const store = storeForPath(sqlitePath);
    if (typeof store.withDb !== 'function') {
      const err = new Error('memory store adapter missing withDb');
      err.code = 'ADAPTER_WITH_DB_REQUIRED';
      throw err;
    }
    return store.withDb((db) => fn(db, { sqlitePath, store }));
  }

  async function close() {
    for (const store of stores.values()) {
      await store.close();
    }
    stores.clear();
  }

  return {
    write,
    read,
    delete: deleteRecords,
    retentionDryRun,
    withProjectDb,
    writeIngestChunkToDb,
    close,
    sqlitePathForMemoryScope: (scope) =>
      sqlitePathForMemoryScope(scope, { pluginRoot, projectRoot }),
    personalRoot,
  };
}

module.exports = {
  createMemoryService,
  assertKnownScope,
  resolveScopeAtSeam,
  workIdForScope,
  sqlitePathForMemoryScope,
  writeIngestChunkToDb,
  isGitHistoryPath,
  requireProvenance,
  toUntrustedEnvelope,
  refuseTrustedInstructionConcatenation,
  normalizeWriteRecord,
  ttlDryRun,
  evaluateExpiry,
  defaultVisibilityForScope,
  resolveTenantLabel,
  GIT_HISTORY_PATH_PREFIX,
  MEMORY_SCOPES,
};
