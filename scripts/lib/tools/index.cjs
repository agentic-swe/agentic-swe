'use strict';

const { ToolRegistry } = require('./registry.cjs');
const { ToolRunner, runTool } = require('./runner.cjs');
const { createGitHubTools, createTestRunnerTool } = require('./connectors.cjs');
const remaining = require('./connectors-remaining.cjs');

function createDefaultRegistry({ github, projectRoot } = {}) {
  const entries = [];
  if (github) entries.push(...createGitHubTools(github));
  entries.push(createTestRunnerTool({ projectRoot }));
  return new ToolRegistry(entries);
}

module.exports = {
  ToolRegistry,
  ToolRunner,
  runTool,
  createDefaultRegistry,
  ...require('./registry.cjs'),
  ...require('./types.cjs'),
  ...require('./connectors.cjs'),
  ...require('./grant-guard.cjs'),
  ...require('./sandbox-profile.cjs'),
  ...require('./sandbox-isolation.cjs'),
  ...remaining,
};
