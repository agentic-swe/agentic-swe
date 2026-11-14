'use strict';

/**
 * AE-036c — skill-scoped / org memory lookup bound to tenant/org.
 * Does not edit skill-registry (Lane B). Shared org memory requires tenant_id.
 * Refs ADR-017 A3.
 */

const {
  resolveMemoryBinding,
  filterRecordsForBinding,
  isSharedOrgTenant,
} = require('./memory-binding.cjs');

/**
 * Look up skill + organizational memory for a caller binding.
 * A request without tenant_id never sees shared org memory.
 *
 * @param {{ read: Function, close?: Function }} memoryService
 * @param {{
 *   projectRoot: string,
 *   tenant_id?: string|null,
 *   org_id?: string|null,
 *   query?: string,
 *   limit?: number,
 * }} opts
 */
async function lookupSkillMemory(memoryService, opts) {
  if (!memoryService || typeof memoryService.read !== 'function') {
    const err = new Error('memoryService.read required');
    err.code = 'MEMORY_SERVICE_REQUIRED';
    throw err;
  }
  const projectRoot = opts && opts.projectRoot;
  if (!projectRoot) {
    const err = new Error('projectRoot required for skill memory lookup');
    err.code = 'MISSING_PROJECT_ROOT';
    throw err;
  }

  const binding = resolveMemoryBinding(projectRoot, {
    tenant_id: opts.tenant_id,
    org_id: opts.org_id,
  });

  const limit = Math.min(200, Math.max(1, Number(opts.limit) || 50));
  const query = opts.query;

  const skillResult = await memoryService.read({
    scope: 'skill',
    query,
    limit,
    tenant_id: binding.tenant_id,
    org_id: binding.org_id,
  });
  const orgResult = await memoryService.read({
    scope: 'organizational',
    query,
    limit,
    tenant_id: binding.tenant_id,
    org_id: binding.org_id,
  });

  const skillRecords = filterRecordsForBinding(skillResult.records || [], binding);
  const orgRecords = filterRecordsForBinding(orgResult.records || [], binding);

  // Defense in depth: drop any shared org row if binding has no tenant_id.
  const orgVisible = orgRecords.filter((r) => {
    if (!isSharedOrgTenant(r.tenant_id)) return true;
    return Boolean(binding.tenant_id);
  });

  return {
    binding,
    skill: skillRecords,
    organizational: orgVisible,
    records: [...skillRecords, ...orgVisible].slice(0, limit),
  };
}

module.exports = {
  lookupSkillMemory,
};
