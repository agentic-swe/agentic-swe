'use strict';

const os = require('node:os');
const path = require('node:path');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('./config.cjs');

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

module.exports = { personalRoot, sqlitePathForScope };
