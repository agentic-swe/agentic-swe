'use strict';

/**
 * AE-037a / ADR-017 A4 — skill visibility enum + access checks (server-side).
 * Layer: skills (service). No tools/ require. No tenant inference from caller.
 *
 * Canonical values (ADR-017): public | organization | team | private.
 * Shorthand "org" normalizes to "organization". Unknown values fail closed.
 * Missing visibility on legacy index entries defaults to public.
 */

const SKILL_VISIBILITY_PUBLIC = 'public';
const SKILL_VISIBILITY_ORGANIZATION = 'organization';
const SKILL_VISIBILITY_TEAM = 'team';
const SKILL_VISIBILITY_PRIVATE = 'private';

const SKILL_VISIBILITIES = new Set([
  SKILL_VISIBILITY_PUBLIC,
  SKILL_VISIBILITY_ORGANIZATION,
  SKILL_VISIBILITY_TEAM,
  SKILL_VISIBILITY_PRIVATE,
]);

/** @type {Readonly<Record<string, string>>} */
const VISIBILITY_ALIASES = Object.freeze({
  org: SKILL_VISIBILITY_ORGANIZATION,
  organisation: SKILL_VISIBILITY_ORGANIZATION,
});

/**
 * Normalize a raw visibility token.
 * Blank/null/undefined → public (legacy default). Unknown → fail closed.
 * @param {unknown} raw
 * @returns {{ ok: true, visibility: string } | { ok: false, code: string, errors: string[] }}
 */
function normalizeSkillVisibility(raw) {
  if (raw == null) {
    return { ok: true, visibility: SKILL_VISIBILITY_PUBLIC };
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    return { ok: true, visibility: SKILL_VISIBILITY_PUBLIC };
  }
  const lower = trimmed.toLowerCase();
  const canonical = VISIBILITY_ALIASES[lower] || lower;
  if (!SKILL_VISIBILITIES.has(canonical)) {
    return {
      ok: false,
      code: 'UNKNOWN_VISIBILITY',
      errors: [`unknown skill visibility: ${trimmed}`],
    };
  }
  return { ok: true, visibility: canonical };
}

/**
 * Read visibility from an index version entry (default public).
 * @param {object | null | undefined} entry
 * @returns {string}
 */
function entryVisibility(entry) {
  const n = normalizeSkillVisibility(entry && entry.visibility);
  // Corrupt stored value fails closed as non-public denial token; callers use access check.
  if (!n.ok) return '__invalid__';
  return n.visibility;
}

/**
 * Validate publish/install visibility + required binding fields.
 * Non-public skills require an explicit tenant_id (never inferred).
 * @param {object} opts
 * @returns {{ ok: true, visibility: string, tenant_id?: string, org_id?: string, team_id?: string, owner_id?: string }
 *   | { ok: false, code: string, errors: string[] }}
 */
function resolvePublishVisibility(opts) {
  const raw =
    opts && opts.visibility != null
      ? opts.visibility
      : opts && opts.skillVisibility != null
        ? opts.skillVisibility
        : undefined;
  const n = normalizeSkillVisibility(raw);
  if (!n.ok) return n;

  const visibility = n.visibility;
  if (visibility === SKILL_VISIBILITY_PUBLIC) {
    return { ok: true, visibility };
  }

  const tenant_id =
    opts && opts.tenant_id != null && String(opts.tenant_id).trim()
      ? String(opts.tenant_id).trim()
      : '';
  if (!tenant_id) {
    return {
      ok: false,
      code: 'TENANT_REQUIRED',
      errors: ['non-public skill visibility requires explicit tenant_id (not inferred)'],
    };
  }

  if (visibility === SKILL_VISIBILITY_ORGANIZATION) {
    const org_id =
      opts && opts.org_id != null && String(opts.org_id).trim()
        ? String(opts.org_id).trim()
        : '';
    if (!org_id) {
      return {
        ok: false,
        code: 'ORG_ID_REQUIRED',
        errors: ['organization visibility requires explicit org_id'],
      };
    }
    return { ok: true, visibility, tenant_id, org_id };
  }

  if (visibility === SKILL_VISIBILITY_TEAM) {
    const org_id =
      opts && opts.org_id != null && String(opts.org_id).trim()
        ? String(opts.org_id).trim()
        : '';
    const team_id =
      opts && opts.team_id != null && String(opts.team_id).trim()
        ? String(opts.team_id).trim()
        : '';
    if (!org_id || !team_id) {
      return {
        ok: false,
        code: 'TEAM_ID_REQUIRED',
        errors: ['team visibility requires explicit org_id and team_id'],
      };
    }
    return { ok: true, visibility, tenant_id, org_id, team_id };
  }

  // private
  const owner_id =
    opts && opts.owner_id != null && String(opts.owner_id).trim()
      ? String(opts.owner_id).trim()
      : opts && opts.user_id != null && String(opts.user_id).trim()
        ? String(opts.user_id).trim()
        : '';
  if (!owner_id) {
    return {
      ok: false,
      code: 'OWNER_REQUIRED',
      errors: ['private visibility requires explicit owner_id (or user_id)'],
    };
  }
  return { ok: true, visibility, tenant_id, owner_id };
}

/**
 * Build index fields to persist alongside a version entry.
 * @param {{ ok: true, visibility: string, tenant_id?: string, org_id?: string, team_id?: string, owner_id?: string }} vis
 * @returns {object}
 */
function visibilityIndexFields(vis) {
  const out = { visibility: vis.visibility };
  if (vis.tenant_id) out.tenant_id = vis.tenant_id;
  if (vis.org_id) out.org_id = vis.org_id;
  if (vis.team_id) out.team_id = vis.team_id;
  if (vis.owner_id) out.owner_id = vis.owner_id;
  return out;
}

/**
 * Server-side access check. Never trusts caller-supplied "include private".
 * Viewer must pass explicit tenant_id for any non-public skill.
 *
 * @param {object} entry index version entry
 * @param {object} [viewer]
 * @param {string} [viewer.catalog] 'public' forces public-only (default when no tenant)
 * @param {string} [viewer.tenant_id]
 * @param {string} [viewer.org_id]
 * @param {string} [viewer.team_id]
 * @param {string} [viewer.user_id]
 * @param {string} [viewer.owner_id]
 * @returns {{ ok: true } | { ok: false, code: string }}
 */
function viewerMayAccessSkill(entry, viewer = {}) {
  const visibility = entryVisibility(entry);
  if (visibility === '__invalid__') {
    return { ok: false, code: 'UNKNOWN_VISIBILITY' };
  }

  const catalog = viewer && viewer.catalog != null ? String(viewer.catalog).trim().toLowerCase() : '';
  const wantPublicCatalog = catalog === 'public' || catalog === '';

  if (visibility === SKILL_VISIBILITY_PUBLIC) {
    return { ok: true };
  }

  // Public catalog / no catalog binding: non-public never visible or installable as public.
  if (wantPublicCatalog && !(viewer && viewer.tenant_id != null && String(viewer.tenant_id).trim())) {
    return { ok: false, code: 'VISIBILITY_DENIED' };
  }

  // Non-public requires explicit tenant_id — never inferred.
  const tenant_id =
    viewer && viewer.tenant_id != null && String(viewer.tenant_id).trim()
      ? String(viewer.tenant_id).trim()
      : '';
  if (!tenant_id) {
    return { ok: false, code: 'TENANT_REQUIRED' };
  }
  const entryTenant =
    entry && entry.tenant_id != null && String(entry.tenant_id).trim()
      ? String(entry.tenant_id).trim()
      : '';
  if (!entryTenant || entryTenant !== tenant_id) {
    return { ok: false, code: 'VISIBILITY_DENIED' };
  }

  if (visibility === SKILL_VISIBILITY_ORGANIZATION) {
    const org_id =
      viewer && viewer.org_id != null && String(viewer.org_id).trim()
        ? String(viewer.org_id).trim()
        : '';
    const entryOrg =
      entry && entry.org_id != null && String(entry.org_id).trim() ? String(entry.org_id).trim() : '';
    if (!org_id || !entryOrg || org_id !== entryOrg) {
      return { ok: false, code: 'VISIBILITY_DENIED' };
    }
    return { ok: true };
  }

  if (visibility === SKILL_VISIBILITY_TEAM) {
    const team_id =
      viewer && viewer.team_id != null && String(viewer.team_id).trim()
        ? String(viewer.team_id).trim()
        : '';
    const entryTeam =
      entry && entry.team_id != null && String(entry.team_id).trim()
        ? String(entry.team_id).trim()
        : '';
    if (!team_id || !entryTeam || team_id !== entryTeam) {
      return { ok: false, code: 'VISIBILITY_DENIED' };
    }
    return { ok: true };
  }

  // private
  const user =
    (viewer && viewer.owner_id != null && String(viewer.owner_id).trim()) ||
    (viewer && viewer.user_id != null && String(viewer.user_id).trim()) ||
    '';
  const entryOwner =
    entry && entry.owner_id != null && String(entry.owner_id).trim()
      ? String(entry.owner_id).trim()
      : '';
  if (!user || !entryOwner || user !== entryOwner) {
    return { ok: false, code: 'VISIBILITY_DENIED' };
  }
  return { ok: true };
}

/**
 * Whether a version entry may appear in a public list/search.
 * @param {object} entry
 * @returns {boolean}
 */
function isPubliclyListable(entry) {
  return entryVisibility(entry) === SKILL_VISIBILITY_PUBLIC;
}

module.exports = {
  SKILL_VISIBILITY_PUBLIC,
  SKILL_VISIBILITY_ORGANIZATION,
  SKILL_VISIBILITY_TEAM,
  SKILL_VISIBILITY_PRIVATE,
  SKILL_VISIBILITIES,
  normalizeSkillVisibility,
  entryVisibility,
  resolvePublishVisibility,
  visibilityIndexFields,
  viewerMayAccessSkill,
  isPubliclyListable,
};
