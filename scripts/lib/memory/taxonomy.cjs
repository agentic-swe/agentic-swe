'use strict';

/**
 * AE-030a — six-type MemoryRecord taxonomy + legacy session/personal/team map.
 * Additive helpers only; runtime writers still use work_id (AE-030b).
 * Refs ADR-012, PD-46, PD-47.
 */

const MEMORY_SCOPES = Object.freeze([
  'execution',
  'repository',
  'project',
  'skill',
  'organizational',
  'evaluation',
]);

const LEGACY_CLI_SCOPES = Object.freeze(['session', 'personal', 'team']);

/** @type {Readonly<Record<'session'|'personal'|'team', string>>} */
const LEGACY_CLI_SCOPE_TO_MEMORY_SCOPE = Object.freeze({
  session: 'execution',
  personal: 'skill',
  team: 'organizational',
});

/**
 * PD-47 retention defaults (fields only; TTL job is AE-030d).
 * ttl_days null = indefinite.
 */
const RETENTION_CLASS_DEFAULTS = Object.freeze({
  session: Object.freeze({ retention_class: 'session', ttl_days: 90 }),
  execution_procedures: Object.freeze({
    retention_class: 'execution_procedures',
    ttl_days: 180,
  }),
  organizational: Object.freeze({ retention_class: 'organizational', ttl_days: 365 }),
  evaluation_negative: Object.freeze({
    retention_class: 'evaluation_negative',
    ttl_days: null,
  }),
});

const DEFAULT_TENANT_ID = 'personal';
const DEFAULT_TRUST = 'untrusted';

/**
 * Map today's scopes.cjs / memory-search --scope value to a MemoryRecord.scope.
 * @param {string} legacyScope
 * @returns {'execution'|'skill'|'organizational'}
 */
function mapLegacyCliScope(legacyScope) {
  const key = String(legacyScope || '').trim();
  const mapped = LEGACY_CLI_SCOPE_TO_MEMORY_SCOPE[key];
  if (!mapped) {
    const err = new Error(`unknown legacy CLI scope: ${key || '(empty)'}`);
    err.code = 'UNKNOWN_LEGACY_SCOPE';
    err.path = 'legacy_scope';
    throw err;
  }
  return mapped;
}

/**
 * Map a chunks.work_id (or null for unscoped repo index rows) to MemoryRecord.scope.
 *
 * | work_id | scope |
 * |---|---|
 * | null / '' | repository |
 * | personal | skill |
 * | team | organizational |
 * | session, session:* | execution |
 * | work:* | execution |
 * | other (worklog id) | project |
 *
 * Note: git-history ingest still stamps work_id=team; MemoryService.resolveScopeAtSeam
 * (AE-030b) remaps path `.agentic-swe/sync/git/*` + work_id=team → repository at read
 * time without rewriting historical chunk bytes.
 *
 * @param {string|null|undefined} workId
 * @returns {(typeof MEMORY_SCOPES)[number]}
 */
function mapLegacyWorkId(workId) {
  if (workId == null) {
    return 'repository';
  }
  const id = String(workId).trim();
  if (id === '') {
    return 'repository';
  }
  if (id === 'personal') {
    return 'skill';
  }
  if (id === 'team') {
    return 'organizational';
  }
  if (id === 'session' || id.startsWith('session:')) {
    return 'execution';
  }
  if (id.startsWith('work:')) {
    return 'execution';
  }
  // Organic / muscle worklog ids and other freeform project keys.
  return 'project';
}

/**
 * Suggested retention_class for a MemoryRecord.scope (PD-47 where applicable).
 * @param {string} scope
 * @param {{ negativeEval?: boolean }} [opts]
 */
function defaultRetentionClassForScope(scope, opts = {}) {
  if (scope === 'evaluation') {
    return opts.negativeEval
      ? RETENTION_CLASS_DEFAULTS.evaluation_negative.retention_class
      : RETENTION_CLASS_DEFAULTS.session.retention_class;
  }
  if (scope === 'organizational') {
    return RETENTION_CLASS_DEFAULTS.organizational.retention_class;
  }
  if (scope === 'execution') {
    return RETENTION_CLASS_DEFAULTS.session.retention_class;
  }
  // repository / project / skill: no PD-47 row; session class is the conservative default.
  return RETENTION_CLASS_DEFAULTS.session.retention_class;
}

module.exports = {
  MEMORY_SCOPES,
  LEGACY_CLI_SCOPES,
  LEGACY_CLI_SCOPE_TO_MEMORY_SCOPE,
  RETENTION_CLASS_DEFAULTS,
  DEFAULT_TENANT_ID,
  DEFAULT_TRUST,
  mapLegacyCliScope,
  mapLegacyWorkId,
  defaultRetentionClassForScope,
};
