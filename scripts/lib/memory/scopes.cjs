'use strict';

const os = require('node:os');
const path = require('node:path');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('./config.cjs');
const taxonomy = require('./taxonomy.cjs');

/**
 * Personal muscle-memory root (~/.agentic-swe). Override with AGENTIC_SWE_PERSONAL_ROOT.
 */
function personalRoot() {
  if (process.env.AGENTIC_SWE_PERSONAL_ROOT) {
    return path.resolve(process.env.AGENTIC_SWE_PERSONAL_ROOT);
  }
  return path.join(os.homedir(), '.agentic-swe');
}

/**
 * @param {'session'|'personal'|'team'} scope
 * @param {{ pluginRoot: string, projectRoot: string }} opts
 */
function sqlitePathForScope(scope, opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot);
  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  if (scope === 'personal') {
    return path.join(personalRoot(), 'memory.sqlite');
  }
  return sqlitePathForProject(merged, projectRoot);
}

module.exports = {
  personalRoot,
  sqlitePathForScope,
  // AE-030a taxonomy (additive; does not change sqlite write paths)
  MEMORY_SCOPES: taxonomy.MEMORY_SCOPES,
  LEGACY_CLI_SCOPES: taxonomy.LEGACY_CLI_SCOPES,
  LEGACY_CLI_SCOPE_TO_MEMORY_SCOPE: taxonomy.LEGACY_CLI_SCOPE_TO_MEMORY_SCOPE,
  RETENTION_CLASS_DEFAULTS: taxonomy.RETENTION_CLASS_DEFAULTS,
  DEFAULT_TENANT_ID: taxonomy.DEFAULT_TENANT_ID,
  DEFAULT_TRUST: taxonomy.DEFAULT_TRUST,
  mapLegacyCliScope: taxonomy.mapLegacyCliScope,
  mapLegacyWorkId: taxonomy.mapLegacyWorkId,
  defaultRetentionClassForScope: taxonomy.defaultRetentionClassForScope,
};
