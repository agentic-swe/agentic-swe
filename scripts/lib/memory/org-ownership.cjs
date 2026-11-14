'use strict';

/**
 * AE-036a — Organization / Team / Project / User / Role / Workspace ownership.
 * Explicit ownership on every resource; unknown type or unknown owner fails closed.
 * Access matrix (cross-org deny) is AE-036b. Refs ADR-017 A3 / C1; PD-53.
 */

const RESOURCE_TYPES = Object.freeze([
  'organization',
  'team',
  'project',
  'user',
  'role',
  'workspace',
]);

/** Kinds that may appear as owner.kind (role/workspace never own). */
const OWNER_KINDS = Object.freeze(['user', 'organization', 'team', 'project']);

/**
 * @param {unknown} type
 * @returns {(typeof RESOURCE_TYPES)[number]}
 */
function assertKnownResourceType(type) {
  const key = String(type == null ? '' : type).trim();
  if (!RESOURCE_TYPES.includes(key)) {
    const err = new Error(`unknown org resource type: ${key || '(empty)'}`);
    err.code = 'UNKNOWN_RESOURCE_TYPE';
    err.path = 'type';
    throw err;
  }
  return /** @type {(typeof RESOURCE_TYPES)[number]} */ (key);
}

/**
 * @param {unknown} kind
 * @returns {(typeof OWNER_KINDS)[number]}
 */
function assertKnownOwnerKind(kind) {
  const key = String(kind == null ? '' : kind).trim();
  if (!OWNER_KINDS.includes(key)) {
    const err = new Error(`unknown owner kind: ${key || '(empty)'}`);
    err.code = 'UNKNOWN_OWNER_KIND';
    err.path = 'owner.kind';
    throw err;
  }
  return /** @type {(typeof OWNER_KINDS)[number]} */ (key);
}

/**
 * Owner catalog entry: must include kind + id (same shape as resource owner refs).
 * @typedef {{ kind: string, id: string }} OwnerRef
 */

/**
 * Build a lookup key for owner identity.
 * @param {OwnerRef} ref
 */
function ownerKey(ref) {
  return `${String(ref.kind).trim()}:${String(ref.id).trim()}`;
}

/**
 * Index known owners from a catalog (resources that can own others, or explicit refs).
 * Fail closed: empty/missing catalog means every owner is unknown.
 * @param {Iterable<OwnerRef|null|undefined>} catalog
 * @returns {Set<string>}
 */
function indexKnownOwners(catalog) {
  const set = new Set();
  if (catalog == null) {
    return set;
  }
  for (const entry of catalog) {
    if (!entry || typeof entry !== 'object') continue;
    const kind = String(entry.kind == null ? '' : entry.kind).trim();
    const id = String(entry.id == null ? '' : entry.id).trim();
    if (!kind || !id) continue;
    if (!OWNER_KINDS.includes(kind)) continue;
    set.add(`${kind}:${id}`);
  }
  return set;
}

/**
 * Assert owner is present and resolvable in the known-owner set.
 * @param {unknown} owner
 * @param {Set<string>} knownOwners
 * @returns {OwnerRef}
 */
function assertKnownOwner(owner, knownOwners) {
  if (owner == null || typeof owner !== 'object' || Array.isArray(owner)) {
    const err = new Error('ownership required: owner object missing');
    err.code = 'MISSING_OWNERSHIP';
    err.path = 'owner';
    throw err;
  }
  const o = /** @type {Record<string, unknown>} */ (owner);
  const kind = assertKnownOwnerKind(o.kind);
  const id = String(o.id == null ? '' : o.id).trim();
  if (!id) {
    const err = new Error('ownership required: owner.id missing');
    err.code = 'MISSING_OWNERSHIP';
    err.path = 'owner.id';
    throw err;
  }
  const key = `${kind}:${id}`;
  if (!knownOwners || !knownOwners.has(key)) {
    const err = new Error(`unknown owner: ${key}`);
    err.code = 'UNKNOWN_OWNER';
    err.path = 'owner';
    throw err;
  }
  return { kind, id };
}

/**
 * Validate a resource record for AE-036a ownership rules (not full Ajv).
 * @param {unknown} resource
 * @param {{ knownOwners?: Iterable<OwnerRef> }} [opts]
 * @returns {{
 *   id: string,
 *   type: string,
 *   tenant_id: string,
 *   display_name: string,
 *   owner: OwnerRef,
 *   parent_id: string|null,
 *   org_id: string|null,
 * }}
 */
function validateOrgResource(resource, opts = {}) {
  if (resource == null || typeof resource !== 'object' || Array.isArray(resource)) {
    const err = new Error('org resource must be an object');
    err.code = 'INVALID_ORG_RESOURCE';
    err.path = '';
    throw err;
  }
  const r = /** @type {Record<string, unknown>} */ (resource);
  const type = assertKnownResourceType(r.type);

  const id = String(r.id == null ? '' : r.id).trim();
  if (!id) {
    const err = new Error('org resource id required');
    err.code = 'MISSING_RESOURCE_ID';
    err.path = 'id';
    throw err;
  }

  const tenantId = String(r.tenant_id == null ? '' : r.tenant_id).trim();
  if (!tenantId) {
    const err = new Error('org resource tenant_id required');
    err.code = 'MISSING_TENANT_ID';
    err.path = 'tenant_id';
    throw err;
  }

  const displayName = String(r.display_name == null ? '' : r.display_name).trim();
  if (!displayName) {
    const err = new Error('org resource display_name required');
    err.code = 'MISSING_DISPLAY_NAME';
    err.path = 'display_name';
    throw err;
  }

  if (!Object.prototype.hasOwnProperty.call(r, 'owner') || r.owner == null) {
    const err = new Error('ownership required: owner field missing');
    err.code = 'MISSING_OWNERSHIP';
    err.path = 'owner';
    throw err;
  }

  const knownOwners = indexKnownOwners(opts.knownOwners || []);
  const owner = assertKnownOwner(r.owner, knownOwners);

  const parentId =
    r.parent_id == null || String(r.parent_id).trim() === ''
      ? null
      : String(r.parent_id).trim();
  const orgId =
    r.org_id == null || String(r.org_id).trim() === ''
      ? null
      : String(r.org_id).trim();

  return {
    id,
    type,
    tenant_id: tenantId,
    display_name: displayName,
    owner,
    parent_id: parentId,
    org_id: orgId,
  };
}

/**
 * Whether a resource has explicit ownership fields (schema-level check without catalog).
 * @param {unknown} resource
 */
function hasExplicitOwnership(resource) {
  if (resource == null || typeof resource !== 'object' || Array.isArray(resource)) {
    return false;
  }
  const r = /** @type {Record<string, unknown>} */ (resource);
  if (!Object.prototype.hasOwnProperty.call(r, 'owner') || r.owner == null) {
    return false;
  }
  if (typeof r.owner !== 'object' || Array.isArray(r.owner)) {
    return false;
  }
  const o = /** @type {Record<string, unknown>} */ (r.owner);
  const kind = String(o.kind == null ? '' : o.kind).trim();
  const id = String(o.id == null ? '' : o.id).trim();
  return Boolean(kind && id && OWNER_KINDS.includes(kind));
}

module.exports = {
  RESOURCE_TYPES,
  OWNER_KINDS,
  assertKnownResourceType,
  assertKnownOwnerKind,
  assertKnownOwner,
  indexKnownOwners,
  ownerKey,
  validateOrgResource,
  hasExplicitOwnership,
};
