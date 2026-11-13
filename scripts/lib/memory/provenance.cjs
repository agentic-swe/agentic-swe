'use strict';

/**
 * AE-030h1/h5 — shared provenance fail-closed helpers for every memory write path.
 * Refs ADR-012 A4 / AE-030c. No default/fake filler — missing fields throw.
 */

const crypto = require('node:crypto');

/**
 * AE-030c / ADR-012 A4 — write without provenance fails closed (no silent defaults).
 * @param {unknown} input
 * @returns {{ origin: string, actor: string, source_hash: string, ingested_at: string, source_uri?: string }}
 */
function requireProvenance(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    input.provenance == null ||
    typeof input.provenance !== 'object' ||
    Array.isArray(input.provenance)
  ) {
    const err = new Error('provenance is required on memory write');
    err.code = 'MISSING_PROVENANCE';
    err.path = 'provenance';
    throw err;
  }
  const provenance = { ...input.provenance };
  for (const key of ['origin', 'actor', 'source_hash', 'ingested_at']) {
    if (provenance[key] == null || String(provenance[key]).trim() === '') {
      const err = new Error(`missing provenance.${key}`);
      err.code = 'MISSING_PROVENANCE_FIELD';
      err.path = `provenance.${key}`;
      throw err;
    }
  }
  return {
    origin: String(provenance.origin),
    actor: String(provenance.actor),
    source_hash: String(provenance.source_hash),
    ingested_at: String(provenance.ingested_at),
    ...(provenance.source_uri != null && String(provenance.source_uri).trim() !== ''
      ? { source_uri: String(provenance.source_uri) }
      : {}),
  };
}

/**
 * Validate record_json that must carry a provenance object (adapter / graph write gate).
 * @param {unknown} recordJson
 * @returns {{ provenance: ReturnType<typeof requireProvenance>, parsed: object }}
 */
function requireProvenanceFromRecordJson(recordJson) {
  if (recordJson == null || String(recordJson).trim() === '') {
    const err = new Error('provenance is required on memory write');
    err.code = 'MISSING_PROVENANCE';
    err.path = 'provenance';
    throw err;
  }
  let parsed;
  try {
    parsed = JSON.parse(String(recordJson));
  } catch {
    const err = new Error('record_json must be valid JSON with provenance');
    err.code = 'MISSING_PROVENANCE';
    err.path = 'record_json';
    throw err;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('provenance is required on memory write');
    err.code = 'MISSING_PROVENANCE';
    err.path = 'provenance';
    throw err;
  }
  const provenance = requireProvenance(parsed);
  return { provenance, parsed };
}

/**
 * Build real ingest provenance (no filler defaults for missing caller data).
 * @param {{
 *   source: string,
 *   originPathOrEvent: string,
 *   actor: string,
 *   sourceHash: string,
 *   ingestedAt?: string,
 * }} opts
 */
function buildIngestProvenance(opts) {
  const source = opts && opts.source != null ? String(opts.source).trim() : '';
  const originPathOrEvent =
    opts && opts.originPathOrEvent != null ? String(opts.originPathOrEvent).trim() : '';
  const actor = opts && opts.actor != null ? String(opts.actor).trim() : '';
  const sourceHash = opts && opts.sourceHash != null ? String(opts.sourceHash).trim() : '';
  if (!source || !originPathOrEvent || !actor || !sourceHash) {
    const err = new Error('ingest provenance requires source, origin path/event, actor, sourceHash');
    err.code = 'MISSING_PROVENANCE';
    err.path = 'provenance';
    throw err;
  }
  return requireProvenance({
    provenance: {
      origin: `${source}:${originPathOrEvent}`,
      actor,
      source_hash: sourceHash,
      ingested_at: opts.ingestedAt || new Date().toISOString(),
      source_uri: originPathOrEvent,
    },
  });
}

/**
 * Attach real ingest provenance to distilled graph nodes before upsertTypedNodes.
 * @param {Array<object>} nodes
 * @param {{
 *   source: string,
 *   actor: string,
 *   originForNode: (n: object) => string,
 *   ingestedAt?: string,
 * }} opts
 */
function attachNodeProvenance(nodes, opts) {
  const list = Array.isArray(nodes) ? nodes : [];
  return list.map((n) => {
    const body = String((n && n.body) || (n && n.id) || '');
    return {
      ...n,
      provenance: buildIngestProvenance({
        source: opts.source,
        originPathOrEvent: opts.originForNode(n),
        actor: opts.actor,
        sourceHash: crypto.createHash('sha256').update(body).digest('hex'),
        ingestedAt: opts.ingestedAt,
      }),
    };
  });
}

module.exports = {
  requireProvenance,
  requireProvenanceFromRecordJson,
  buildIngestProvenance,
  attachNodeProvenance,
};
