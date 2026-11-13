'use strict';

/**
 * AE-030d — retention TTL defaults (PD-47), expiry helpers, dry-run reporter.
 * No network. Refs ADR-012 A5, PD-46/PD-47.
 */

const { RETENTION_CLASS_DEFAULTS } = require('./taxonomy.cjs');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @param {string} retentionClass
 * @returns {number|null} ttl_days or null for indefinite
 */
function ttlDaysForRetentionClass(retentionClass) {
  const key = String(retentionClass || '');
  const row = RETENTION_CLASS_DEFAULTS[key];
  if (!row) return RETENTION_CLASS_DEFAULTS.session.ttl_days;
  return row.ttl_days;
}

/**
 * @param {object} record MemoryRecord-shaped
 * @param {number} [nowMs]
 * @returns {{ expired: boolean, expiresAt: string|null, ttlDays: number|null }}
 */
function evaluateExpiry(record, nowMs = Date.now()) {
  if (record && record.expires_at != null && String(record.expires_at).trim() !== '') {
    const exp = Date.parse(String(record.expires_at));
    if (Number.isFinite(exp)) {
      return {
        expired: exp <= nowMs,
        expiresAt: new Date(exp).toISOString(),
        ttlDays: null,
      };
    }
  }
  const retentionClass =
    (record && record.retention_class) ||
    'session';
  const ttlDays = ttlDaysForRetentionClass(retentionClass);
  if (ttlDays == null) {
    return { expired: false, expiresAt: null, ttlDays: null };
  }
  const ingested =
    record &&
    record.provenance &&
    record.provenance.ingested_at
      ? Date.parse(String(record.provenance.ingested_at))
      : NaN;
  if (!Number.isFinite(ingested)) {
    return { expired: false, expiresAt: null, ttlDays };
  }
  const expiresAtMs = ingested + ttlDays * MS_PER_DAY;
  return {
    expired: expiresAtMs <= nowMs,
    expiresAt: new Date(expiresAtMs).toISOString(),
    ttlDays,
  };
}

/**
 * Dry-run TTL report: expired ids only; never touches network or storage.
 * @param {object[]} records
 * @param {{ now?: string|number|Date }} [opts]
 */
function ttlDryRun(records, opts = {}) {
  const nowMs =
    opts.now == null
      ? Date.now()
      : opts.now instanceof Date
        ? opts.now.getTime()
        : typeof opts.now === 'number'
          ? opts.now
          : Date.parse(String(opts.now));
  const expired = [];
  const retained = [];
  for (const rec of records || []) {
    const ev = evaluateExpiry(rec, nowMs);
    const row = {
      id: rec && rec.id != null ? String(rec.id) : '',
      scope: rec && rec.scope != null ? String(rec.scope) : '',
      retention_class: rec && rec.retention_class != null ? String(rec.retention_class) : '',
      expires_at: ev.expiresAt,
      ttl_days: ev.ttlDays,
    };
    if (ev.expired) expired.push(row);
    else retained.push(row);
  }
  return {
    dry_run: true,
    now: new Date(nowMs).toISOString(),
    expired,
    retained,
    expired_ids: expired.map((e) => e.id).filter(Boolean),
  };
}

/**
 * PD-46 visibility defaults.
 * @param {string} scope
 * @param {string|null|undefined} explicit
 */
function defaultVisibilityForScope(scope, explicit) {
  if (explicit != null && String(explicit).trim() !== '') {
    return String(explicit).trim();
  }
  if (scope === 'organizational') return 'private';
  if (scope === 'skill') return 'private';
  return 'private';
}

/**
 * PD-46: personal/skill memory carries explicit tenant label; org stays local/private.
 * @param {string} scope
 * @param {string|null|undefined} tenantId
 * @param {string} defaultTenant
 */
function resolveTenantLabel(scope, tenantId, defaultTenant) {
  if (tenantId != null && String(tenantId).trim() !== '') {
    return String(tenantId).trim();
  }
  if (scope === 'skill') return defaultTenant || 'personal';
  if (scope === 'organizational') return 'local';
  return defaultTenant || 'personal';
}

module.exports = {
  MS_PER_DAY,
  ttlDaysForRetentionClass,
  evaluateExpiry,
  ttlDryRun,
  defaultVisibilityForScope,
  resolveTenantLabel,
};
