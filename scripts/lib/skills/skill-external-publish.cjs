'use strict';

/**
 * AE-028b: maintainer-only governed publication for externally contributed skills.
 * Layer: skills (service). No tools/ require.
 *
 * Requires an explicit human approval record (actor + approval reference such as
 * a merged PR number) before publishSkill is allowed. Fail-closed origin
 * allowlist: only `third-party` may publish on the external path (M3-F7).
 * Schema enum also lists first-party/generated/unknown; those stay installable
 * via other paths but are refused here. Version metadata uses existing
 * immutable versions + digest + git tag `skill/<name>/v<semver>` (PD-30).
 */

const fs = require('node:fs');
const path = require('node:path');
const { publishSkill, gitTagRef } = require('./skill-registry.cjs');

/**
 * Origins allowed for governed external publication (fail closed otherwise).
 * Matches the public-safe external contribution intent (third-party only).
 */
const ALLOWED_EXTERNAL_ORIGINS = new Set(['third-party']);

/** @deprecated Prefer ALLOWED_EXTERNAL_ORIGINS; kept for older test imports. */
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
 * - provenance.origin not in ALLOWED_EXTERNAL_ORIGINS → ORIGIN_NOT_ALLOWED
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

  if (!ALLOWED_EXTERNAL_ORIGINS.has(identity.origin)) {
    return {
      ok: false,
      code: 'ORIGIN_NOT_ALLOWED',
      errors: [
        `provenance.origin ${JSON.stringify(identity.origin)} is not on the external-publish allowlist (${[...ALLOWED_EXTERNAL_ORIGINS].join(', ')}); refusing publication`,
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
    // AE-030h2: external governed publish declares public-safe memory source explicitly.
    memorySource: { declaration: 'external-public', publicSafe: true },
    governedPublish: true,
    // AE-032c: forward independent review artifact when provided; otherwise
    // publishSkill loads sourceDir/publish-review.json (required).
    reviewArtifact: options.reviewArtifact,
    reviewPath: options.reviewPath,
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
  ALLOWED_EXTERNAL_ORIGINS,
  PRIVATE_ORG_ORIGINS,
  normalizeApprovalRef,
  normalizePublishActor,
  readContributionIdentity,
  publishExternalContribution,
};
