'use strict';

/**
 * AE-039a / ADR-017 / PD-62 C2: disk-backed org RBAC bindings.
 *
 * Separate from agent config/roles/*.json. Pack defaults are empty.
 * Pilot bindings live under project `.agentic-swe/org-rbac/` (or an explicit
 * bindingsDir). Empty / missing / invalid → deny for org-scoped ops.
 * Never reads caller-supplied grants for elevation.
 *
 * Layer: policy (core).
 */

const fs = require('node:fs');
const path = require('node:path');

const BINDINGS_REL = path.join('.agentic-swe', 'org-rbac');
const RULE_ID_DENY = 'org.rbac.deny';
const RULE_ID_ALLOW = 'org.rbac.allow';

let schemaValidator = null;

function getValidator() {
  if (schemaValidator) return schemaValidator;
  const Ajv = require('ajv').default;
  const schemaPath = path.join(__dirname, '..', '..', '..', 'schemas', 'org-rbac-binding.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  schemaValidator = new Ajv({ allErrors: true, strict: false }).compile(schema);
  return schemaValidator;
}

/**
 * @param {unknown} binding
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateBinding(binding) {
  const validate = getValidator();
  if (validate(binding)) return { ok: true, errors: [] };
  const errors = (validate.errors || []).map((e) => `${e.instancePath || '/'} ${e.message}`);
  return { ok: false, errors };
}

/**
 * Resolve bindings directory. Prefer explicit dirs; never invent grants.
 * @param {{ bindingsDir?: string|null, projectRoot?: string|null, workDir?: string|null }} opts
 * @returns {string|null}
 */
function resolveBindingsDir(opts = {}) {
  if (typeof opts.bindingsDir === 'string' && opts.bindingsDir.trim()) {
    return path.resolve(opts.bindingsDir.trim());
  }
  if (typeof opts.projectRoot === 'string' && opts.projectRoot.trim()) {
    return path.resolve(opts.projectRoot.trim(), BINDINGS_REL);
  }
  const workDir = typeof opts.workDir === 'string' ? opts.workDir.trim() : '';
  if (!workDir) return null;
  let cur = path.resolve(workDir);
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(cur, BINDINGS_REL);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/**
 * Load valid bindings from disk. Invalid files are skipped (fail closed:
 * they never grant). Missing dir → empty list.
 *
 * @param {string|null|undefined} dir
 * @returns {{ bindings: object[], errors: string[] }}
 */
function loadBindings(dir) {
  const bindings = [];
  const errors = [];
  if (!dir || typeof dir !== 'string') {
    return { bindings, errors };
  }
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (e) {
    if (e && e.code === 'ENOENT') return { bindings, errors };
    return { bindings, errors: [`org-rbac directory unreadable: ${e.message}`] };
  }
  for (const f of files) {
    const full = path.join(dir, f);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      errors.push(`${f} is not valid JSON: ${e.message}`);
      continue;
    }
    const v = validateBinding(raw);
    if (!v.ok) {
      errors.push(`${f} is invalid: ${v.errors.join('; ')}`);
      continue;
    }
    bindings.push(raw);
  }
  return { bindings, errors };
}

/**
 * Detect org-scoped context from PDP input.
 * Requires tenant_id AND at least one of org_id / team_id / project_id.
 * Caller-supplied grant flags are ignored here and elsewhere.
 *
 * @param {object} input
 * @returns {null | { tenantId: string, resource: { type: string, id: string }, principal: string, action: string }}
 */
function extractOrgScopedContext(input = {}) {
  const org = input.org && typeof input.org === 'object' && !Array.isArray(input.org) ? input.org : null;
  const tenantId = firstNonEmpty(
    input.tenant_id,
    input.tenantId,
    org && org.tenant_id,
    org && org.tenantId
  );
  if (!tenantId) return null;

  const orgId = firstNonEmpty(input.org_id, input.orgId, org && org.org_id, org && org.orgId);
  const teamId = firstNonEmpty(input.team_id, input.teamId, org && org.team_id, org && org.teamId);
  const projectId = firstNonEmpty(
    input.project_id,
    input.projectId,
    org && org.project_id,
    org && org.projectId
  );

  let resource = null;
  // Most specific wins when multiple are present.
  if (projectId) resource = { type: 'project', id: projectId };
  else if (teamId) resource = { type: 'team', id: teamId };
  else if (orgId) resource = { type: 'organization', id: orgId };
  if (!resource) return null;

  const principal = firstNonEmpty(
    input.principal,
    input.actor && typeof input.actor === 'object' && input.actor.principal,
    input.actor && typeof input.actor === 'object' && input.actor.actor,
    input.actor && typeof input.actor === 'object' && input.actor.role
      ? `role:${input.actor.role}`
      : null
  );
  if (!principal) {
    // Org-scoped without a principal still fails closed at evaluate time,
    // but context is present so the PDP must run the check.
    return {
      tenantId,
      resource,
      principal: '',
      action: resolveAction(input),
    };
  }

  return {
    tenantId,
    resource,
    principal,
    action: resolveAction(input),
  };
}

function resolveAction(input = {}) {
  const explicit = firstNonEmpty(input.action, input.org_action, input.orgAction);
  if (explicit) return explicit;
  if (input.op != null && String(input.op).trim()) return String(input.op).trim();
  if (input.toolName != null && String(input.toolName).trim()) return String(input.toolName).trim();
  return '';
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/**
 * Evaluate org access against disk bindings only.
 * Never consults caller-supplied authorized / grants / flags.
 *
 * @param {{
 *   tenantId: string,
 *   resource: { type: string, id: string },
 *   action: string,
 *   principal: string,
 *   bindingsDir?: string|null,
 *   projectRoot?: string|null,
 *   workDir?: string|null,
 *   bindings?: object[]|null,
 * }} params
 * @returns {{ decision: 'allow'|'deny', rule_id: string, reason: string, code: string }}
 */
function evaluateOrgAccess(params = {}) {
  const tenantId = typeof params.tenantId === 'string' ? params.tenantId.trim() : '';
  const principal = typeof params.principal === 'string' ? params.principal.trim() : '';
  const action = typeof params.action === 'string' ? params.action.trim() : '';
  const resource =
    params.resource && typeof params.resource === 'object' ? params.resource : null;
  const resourceType = resource && typeof resource.type === 'string' ? resource.type.trim() : '';
  const resourceId = resource && resource.id != null ? String(resource.id).trim() : '';

  if (!tenantId || !resourceType || !resourceId || !principal || !action) {
    return {
      decision: 'deny',
      rule_id: RULE_ID_DENY,
      reason:
        'org-scoped operation denied: missing tenant_id, resource, principal, or action (fail closed)',
      code: 'ORG_RBAC_DENY',
    };
  }

  // Intentionally ignore any caller grant fields that may sit on params.
  const loaded =
    Array.isArray(params.bindings)
      ? { bindings: params.bindings, errors: [] }
      : loadBindings(
          resolveBindingsDir({
            bindingsDir: params.bindingsDir,
            projectRoot: params.projectRoot,
            workDir: params.workDir,
          })
        );

  if (!loaded.bindings.length) {
    return {
      decision: 'deny',
      rule_id: RULE_ID_DENY,
      reason: loaded.errors.length
        ? `org-scoped operation denied: no valid bindings (${loaded.errors[0]})`
        : 'org-scoped operation denied: no matching org RBAC binding on disk (empty or missing store)',
      code: 'ORG_RBAC_DENY',
    };
  }

  for (const b of loaded.bindings) {
    if (!b || b.tenant_id !== tenantId) continue;
    if (!b.resource || b.resource.type !== resourceType || b.resource.id !== resourceId) continue;
    if (b.principal !== principal) continue;
    if (!Array.isArray(b.actions) || !b.actions.includes(action)) continue;
    return {
      decision: 'allow',
      rule_id: RULE_ID_ALLOW,
      reason: `org RBAC binding allows ${principal} ${action} on ${resourceType}:${resourceId} (tenant ${tenantId})`,
      code: 'ORG_RBAC_ALLOW',
    };
  }

  return {
    decision: 'deny',
    rule_id: RULE_ID_DENY,
    reason: `org-scoped operation denied: no binding for (${tenantId}, ${resourceType}:${resourceId}, ${principal}, ${action})`,
    code: 'ORG_RBAC_DENY',
  };
}

module.exports = {
  BINDINGS_REL,
  RULE_ID_DENY,
  RULE_ID_ALLOW,
  validateBinding,
  resolveBindingsDir,
  loadBindings,
  extractOrgScopedContext,
  evaluateOrgAccess,
};
