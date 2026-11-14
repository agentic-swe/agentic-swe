'use strict';

/**
 * AE-038b — Public-learning ingest guards for private→public.
 * Ingesting private/org-sourced memory into public learning requires auth_ref.
 * Missing auth_ref fails closed. Allowed path records an audit entry.
 * Refs ADR-012 A6; ADR-017 A1; PD-53.
 */

const fs = require('node:fs');
const path = require('node:path');

const PRIVATEISH_VISIBILITY = new Set(['private', 'local']);
const PRIVATEISH_SCOPES = new Set(['organizational', 'skill', 'project', 'execution']);

/**
 * @param {unknown} v
 * @returns {string|null}
 */
function nonEmpty(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Whether a source memory record is private/org-bound (needs auth to go public).
 * @param {object} source
 */
function isPrivateLearningSource(source) {
  if (!source || typeof source !== 'object') return true; // fail closed
  const visibility = nonEmpty(source.visibility) || 'private';
  const scope = nonEmpty(source.scope) || '';
  if (visibility === 'public') return false;
  if (PRIVATEISH_VISIBILITY.has(visibility)) return true;
  if (PRIVATEISH_SCOPES.has(scope)) return true;
  // Explicit org share stamp
  if (nonEmpty(source.org_id) || nonEmpty(source.team_id)) return true;
  return visibility !== 'public';
}

/**
 * @param {string} projectRoot
 */
function publicLearningAuditPath(projectRoot) {
  return path.join(path.resolve(projectRoot), '.agentic-swe', 'public-learning-audit.jsonl');
}

/**
 * Append an audit line for an authorized private→public ingest.
 * @param {string} projectRoot
 * @param {object} entry
 */
function appendPublicLearningAudit(projectRoot, entry) {
  const file = publicLearningAuditPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
}

/**
 * Assert public-learning ingest is allowed for a private source.
 * @param {{
 *   source: object,
 *   auth_ref?: string|null,
 *   destination?: string,
 *   actor?: string,
 * }} opts
 * @returns {{ allowed: true, auth_ref: string, audit: object }}
 */
function assertPublicLearningIngestAuthorized(opts) {
  const source = opts && opts.source;
  if (!isPrivateLearningSource(source)) {
    return {
      allowed: true,
      auth_ref: null,
      audit: { skipped: true, reason: 'source_already_public' },
    };
  }

  const authRef = nonEmpty(opts && opts.auth_ref);
  if (!authRef) {
    const err = new Error(
      'public learning ingest of private/org source requires auth_ref (missing auth_ref fails closed)'
    );
    err.code = 'PUBLIC_LEARNING_AUTH_REF_REQUIRED';
    err.path = 'auth_ref';
    throw err;
  }

  const audit = {
    at: new Date().toISOString(),
    action: 'private_to_public_learning',
    auth_ref: authRef,
    source_id: nonEmpty(source && source.id) || null,
    source_scope: nonEmpty(source && source.scope) || null,
    source_visibility: nonEmpty(source && source.visibility) || 'private',
    source_tenant_id: nonEmpty(source && source.tenant_id) || null,
    destination: nonEmpty(opts.destination) || 'public_learning',
    actor: nonEmpty(opts.actor) || 'system',
  };

  return { allowed: true, auth_ref: authRef, audit };
}

/**
 * Ingest a private/org memory record into the public learning store.
 * Requires auth_ref; writes audit; delegates append to learning-store.
 *
 * @param {string} projectRoot
 * @param {{
 *   source: object,
 *   learningRecord: object,
 *   auth_ref?: string|null,
 *   actor?: string,
 * }} opts
 */
function ingestPrivateToPublicLearning(projectRoot, opts) {
  const gate = assertPublicLearningIngestAuthorized({
    source: opts.source,
    auth_ref: opts.auth_ref,
    destination: 'public_learning',
    actor: opts.actor,
  });

  if (gate.audit && !gate.audit.skipped) {
    appendPublicLearningAudit(projectRoot, gate.audit);
  }

  const { appendLearningRecord } = require('./learning-store.cjs');
  const learningRecord = {
    ...(opts.learningRecord || {}),
    // Stamp authorization on the learning row for provenance.
    ...(gate.auth_ref ? { auth_ref: gate.auth_ref } : {}),
  };
  const result = appendLearningRecord(projectRoot, learningRecord);
  return { ...result, audit: gate.audit, auth_ref: gate.auth_ref };
}

module.exports = {
  isPrivateLearningSource,
  assertPublicLearningIngestAuthorized,
  ingestPrivateToPublicLearning,
  publicLearningAuditPath,
  appendPublicLearningAudit,
};
