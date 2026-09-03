'use strict';

/**
 * Cursor runtime adapter (typed actions → Cursor tool names).
 */
const TOOL_MAP = {
  READ_FILE: (action) => ({ tool: 'Read', params: { path: action.path } }),
  WRITE_FILE: (action) => ({ tool: 'Write', params: { path: action.path, contents: action.contents } }),
  EDIT_FILE: (action) => ({
    tool: 'StrReplace',
    params: { path: action.path, old_string: action.old_string, new_string: action.new_string },
  }),
  RUN: (action) => ({ tool: 'Shell', params: { command: action.command } }),
  SEARCH: (action) => ({ tool: 'Grep', params: { pattern: action.pattern, path: action.path } }),
  GLOB: (action) => ({ tool: 'Glob', params: { glob_pattern: action.pattern } }),
  SPAWN_SUBAGENT: (action) => ({
    tool: 'Task',
    params: { prompt: action.prompt, description: action.description },
  }),
  LIST_DIR: (action) => ({ tool: 'Glob', params: { glob_pattern: '*' } }),
  GIT: (action) => ({ tool: 'Shell', params: { command: `git ${action.subcommand}` } }),
  WEB_FETCH: (action) => ({ tool: 'WebFetch', params: { url: action.url } }),
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
