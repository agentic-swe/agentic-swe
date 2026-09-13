'use strict';

/**
 * OpenCode runtime adapter (typed actions → OpenCode plugin tools).
 */
const TOOL_MAP = {
  READ_FILE: (action) => ({ tool: 'opencode.file.read', params: { path: action.path } }),
  WRITE_FILE: (action) => ({ tool: 'opencode.file.write', params: { path: action.path, content: action.contents } }),
  EDIT_FILE: (action) => ({
    tool: 'opencode.file.edit',
    params: { path: action.path, old_string: action.old_string, new_string: action.new_string },
  }),
  RUN: (action) => ({ tool: 'opencode.shell.exec', params: { command: action.command } }),
  SEARCH: (action) => ({ tool: 'opencode.shell.exec', params: { command: `rg ${JSON.stringify(action.pattern)}` } }),
  GLOB: (action) => ({ tool: 'opencode.file.list', params: { glob: action.pattern } }),
  SPAWN_SUBAGENT: (action) => ({ tool: 'opencode.agent.spawn', params: { prompt: action.prompt } }),
  LIST_DIR: (action) => ({ tool: 'opencode.file.list', params: { path: action.path } }),
  GIT: (action) => ({ tool: 'opencode.shell.exec', params: { command: `git ${action.subcommand}` } }),
  WEB_FETCH: (action) => ({ tool: 'opencode.web.fetch', params: { url: action.url } }),
};

function translate(action) {
  const translator = TOOL_MAP[action.type];
  if (!translator) throw new Error(`Unknown action type: ${action.type}`);
  return translator(action);
}

function translateAll(actions) {
  return actions.map(translate);
}

module.exports = { translate, translateAll, TOOL_MAP };
