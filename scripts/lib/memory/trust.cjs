'use strict';

function isJevEvidence(record) {
  return record.actor === 'jev' || record.kind === 'pipeline.jev_track';
}

function annotateTrust(record, now) {
  return {
    ...record,
    source: record.source || 'manual',
    scope: record.scope || 'project',
    confidence: record.confidence == null ? 0.5 : record.confidence,
    last_confirmed: record.last_confirmed || now,
    external: Boolean(record.external),
    promoted: Boolean(record.promoted),
  };
}

function decayConfidence(record, now, windowMs) {
  const elapsed = Math.floor((Date.parse(now) - Date.parse(record.last_confirmed)) / windowMs);
  return { ...record, confidence: Math.max(0, Number((record.confidence - (0.1 * Math.max(0, elapsed))).toFixed(1))) };
}

function canReplay(record) {
  return !record.external || record.promoted === true;
}

function promoteTrust(record, { confirmations, humanApproved }) {
  if (isJevEvidence(record)) throw new Error('jev evidence cannot be promoted');
  if (confirmations >= 2 || humanApproved === true) return { ...record, promoted: true };
  return { ...record, promoted: false };
}

module.exports = { annotateTrust, canReplay, decayConfidence, isJevEvidence, promoteTrust };
