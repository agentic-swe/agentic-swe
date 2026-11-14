'use strict';

function isJevEvidence(record) {
  return record.actor === 'jev' || record.kind === 'pipeline.jev_track';
}

/**
 * AE-R1: provenance source must be explicit. Missing/blank source fails closed.
 * `source: 'manual'` is allowed only when `actor` is `'user'` (human caller).
 * Does not change trust levels or human_approved / promoteTrust rules (AE-R04).
 */
function annotateTrust(record, now) {
  const source = record && record.source != null ? String(record.source).trim() : '';
  if (!source) {
    throw new Error('annotateTrust requires an explicit source (AE-R1)');
  }
  if (source === 'manual' && record.actor !== 'user') {
    throw new Error("annotateTrust source 'manual' requires actor 'user' (AE-R1)");
  }
  return {
    ...record,
    source,
    scope: record.scope || 'project',
    confidence: record.confidence == null ? 0.5 : record.confidence,
    last_confirmed: record.last_confirmed || now,
    external: Boolean(record.external),
    promoted: Boolean(record.promoted),
  };
}

function canReplay(record) {
  return !record.external || record.promoted === true;
}

function promoteTrust(record, { confirmations, humanApproved }) {
  if (isJevEvidence(record)) throw new Error('jev evidence cannot be promoted');
  if (confirmations >= 2 || humanApproved === true) return { ...record, promoted: true };
  return { ...record, promoted: false };
}

module.exports = { annotateTrust, canReplay, isJevEvidence, promoteTrust };
