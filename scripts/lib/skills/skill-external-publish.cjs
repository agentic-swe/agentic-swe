'use strict';

/**
 * AE-028b: maintainer-only governed publication for externally contributed skills.
 * Layer: skills (service). No tools/ require.
 *
 * Requires an explicit human approval record (actor + approval reference such as
 * a merged PR number) before publishSkill is allowed. Refuses provenance.origin
 * values that mark private/org knowledge (§16 — no silent private→public).
 * Version metadata uses existing immutable versions + digest + git tag
 * `skill/<name>/v<semver>` (PD-30).
 */

const fs = require('node:fs');
const path = require('node:path');
const { publishSkill, gitTagRef } = require('./skill-registry.cjs');

/**
 * Origin values that mark private or org-internal knowledge.
 * Public publication of these is refused (fail closed).
 */
const PRIVATE_ORG_ORIGINS = new Set([
  'private',
  'org',
  'org-private',
  'org_private',
  'internal',
  'confidential',
]);

/**
 * Normalize a non-blank approval reference (e.g. PR number or review URL).
 * @param {unknown} value
 * @returns {string}
 */
function normalizeApprovalRef(value) {
  const ref = String(value == null ? '' : value).trim();
  if (!ref) {
    const err = new Error('approval reference required for external skill publication');
    err.code = 'APPROVAL_REQUIRED';
    throw err;
  }
  return ref;
}

/**
 * Normalize actor (non-blank).
 * @param {unknown} value
 * @returns {string}
 */
function normalizePublishActor(value) {
  const actor = String(value == null ? '' : value).trim();
  if (!actor) {
    const err = new Error('actor required for external skill publication');
    err.code = 'ACTOR_REQUIRED';
    throw err;
  }
  return actor;
}

/**
 * Read provenance.origin from a contribution directory. Fail closed on missing
 * / unreadable / blank origin (does not invent values).
 * @param {string} sourceDir
 * @returns {{ ok: true, origin: string, digest: string, manifest: object } | { ok: false, code: string, errors: string[] }}
 */
function readContributionIdentity(sourceDir) {
  const abs = path.resolve(sourceDir);
  const manifestPath = path.join(abs, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, code: 'MANIFEST_MISSING', errors: [`missing manifest.json under ${abs}`] };
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err) {
    return { ok: false, code: 'MANIFEST_PARSE', errors: [err.message] };
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, code: 'MANIFEST_INVALID', errors: ['manifest is not an object'] };
  }
  const provenance = manifest.provenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    return { ok: false, code: 'PROVENANCE_MISSING', errors: ['manifest.provenance missing'] };
  }
  const origin = String(provenance.origin == null ? '' : provenance.origin).trim().toLowerCase();
  if (!origin) {
    return { ok: false, code: 'PROVENANCE_ORIGIN_BLANK', errors: ['manifest.provenance.origin is blank'] };
  }
  const digest = String(manifest.digest == null ? '' : manifest.digest).trim().toLowerCase();
  if (!digest) {
    return { ok: false, code: 'DIGEST_MISSING', errors: ['manifest.digest is blank'] };
  }
  return { ok: true, origin, digest, manifest };
}

/**
 * Publish an externally contributed skill after human approval.
 *
 * Fail closed on:
 * - missing/blank actor → ACTOR_REQUIRED
 * - missing/blank approvalRef → APPROVAL_REQUIRED
 * - private/org provenance.origin → PRIVATE_PROVENANCE_FORBIDDEN
 * - expectedDigest provided but blank → DIGEST_EXPECTED_BLANK
 * - expectedDigest mismatches package digest → DIGEST_MISMATCH
 * - blank package digest → DIGEST_MISSING
 *
 * On success: publishSkill with approval_ref in the registry audit log + git tag ref.
 *
 * @param {{
 *   registryRoot: string,
 *   sourceDir: string,
 *   actor?: string,
 *   approvalRef?: string,
 *   expectedDigest?: string,
 * }} opts
 * @returns {{ ok: boolean, code?: string, errors?: string[], tag?: string, actor?: string, approvalRef?: string, digest?: string, manifest?: object, path?: string, origin?: string, expectedDigest?: string }}
 */
function publishExternalContribution(opts) {
  const options = opts || {};
  let actor;
  let approvalRef;
  try {
    actor = normalizePublishActor(options.actor);
    approvalRef = normalizeApprovalRef(options.approvalRef);
  } catch (err) {
    return { ok: false, code: err.code || 'APPROVAL_REQUIRED', errors: [err.message] };
  }

  const identity = readContributionIdentity(options.sourceDir);
  if (!identity.ok) return identity;

  if (PRIVATE_ORG_ORIGINS.has(identity.origin)) {
    return {
      ok: false,
      code: 'PRIVATE_PROVENANCE_FORBIDDEN',
      errors: [
        `provenance.origin ${JSON.stringify(identity.origin)} marks private/org knowledge; refusing public publication (§16)`,
      ],
      origin: identity.origin,
    };
  }

  if (Object.prototype.hasOwnProperty.call(options, 'expectedDigest')) {
    const expected = String(options.expectedDigest == null ? '' : options.expectedDigest)
      .trim()
      .toLowerCase();
    if (!expected) {
      return {
        ok: false,
        code: 'DIGEST_EXPECTED_BLANK',
        errors: ['expectedDigest was provided but is blank'],
      };
    }
    if (expected !== identity.digest) {
      return {
        ok: false,
        code: 'DIGEST_MISMATCH',
        errors: [
          `expectedDigest ${expected} does not match package digest ${identity.digest}`,
        ],
        digest: identity.digest,
        expectedDigest: expected,
      };
    }
  }

  const result = publishSkill({
    registryRoot: options.registryRoot,
    sourceDir: options.sourceDir,
    actor,
    approvalRef,
  });
  if (!result.ok) return result;

  return {
    ok: true,
    tag: result.tag || gitTagRef(result.manifest.name, result.manifest.version),
    actor,
    approvalRef,
    digest: result.digest,
    manifest: result.manifest,
    path: result.path,
  };
}

module.exports = {
  PRIVATE_ORG_ORIGINS,
  normalizeApprovalRef,
  normalizePublishActor,
  readContributionIdentity,
  publishExternalContribution,
};
