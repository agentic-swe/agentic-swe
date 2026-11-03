'use strict';

/**
 * Map each host's PreToolUse / pre-* stdin JSON to a shared shape for policy evaluation.
 * Official contracts are documented in references/policy-as-code.md (host contract table).
 */

function firstString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function asObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
}

function empty(errors = []) {
  return { toolName: '', toolInput: undefined, cwd: null, workspaceRoots: [], errors };
}

/** Claude Code / Cursor / Codex / Kiro / OpenCode (plugin-fed): tool_name + tool_input. */
function normalizeClaudeLike(input) {
  const roots = Array.isArray(input.workspace_roots)
    ? input.workspace_roots
    : Array.isArray(input.workspaceRoots)
      ? input.workspaceRoots
      : [];
  return {
    toolName: String(firstString(input.tool_name, input.toolName) || ''),
    toolInput: input.tool_input !== undefined ? input.tool_input : input.toolArgs,
    cwd: firstString(input.cwd),
    workspaceRoots: roots.filter((r) => typeof r === 'string'),
    errors: [],
  };
}

/**
 * Antigravity: toolCall.name + toolCall.args (CommandLine / TargetFile / AbsolutePath).
 * https://antigravity.google/docs/hooks/
 */
function normalizeAntigravity(input) {
  const call = asObject(input.toolCall);
  if (!call) return empty(['antigravity payload missing toolCall']);
  const args = asObject(call.args) || {};
  const name = String(call.name || '');
  const roots = Array.isArray(input.workspacePaths) ? input.workspacePaths.filter((r) => typeof r === 'string') : [];
  let toolName = name;
  let toolInput = { ...args };

  if (name === 'run_command') {
    toolName = 'Bash';
    toolInput = {
      command: firstString(args.CommandLine, args.command_line, args.command) || '',
      cwd: firstString(args.Cwd, args.cwd),
    };
  } else if (name === 'write_to_file') {
    toolName = 'Write';
    toolInput = { file_path: firstString(args.TargetFile, args.file_path, args.path) || '' };
  } else if (name === 'replace_file_content' || name === 'multi_replace_file_content') {
    toolName = 'Edit';
    toolInput = { file_path: firstString(args.TargetFile, args.file_path, args.path) || '' };
  } else if (name === 'view_file') {
    toolName = 'Read';
    toolInput = { file_path: firstString(args.AbsolutePath, args.file_path, args.path) || '' };
  }

  return {
    toolName,
    toolInput,
    cwd: firstString(args.Cwd, args.cwd, roots[0]),
    workspaceRoots: roots,
    errors: name ? [] : ['antigravity toolCall has no name'],
  };
}

/**
 * Windsurf Cascade: agent_action_name + tool_info.
 * https://docs.devin.ai/desktop/cascade/hooks
 */
function normalizeWindsurf(input) {
  const action = firstString(input.agent_action_name) || '';
  const info = asObject(input.tool_info) || {};
  const roots = [];
  const root = firstString(info.root_workspace_path, info.cwd);
  if (root) roots.push(root);

  if (action === 'pre_run_command') {
    return {
      toolName: 'Bash',
      toolInput: { command: firstString(info.command_line, info.command) || '' },
      cwd: firstString(info.cwd, root),
      workspaceRoots: roots,
      errors: [],
    };
  }
  if (action === 'pre_write_code') {
    return {
      toolName: 'Write',
      toolInput: { file_path: firstString(info.file_path) || '', edits: info.edits },
      cwd: firstString(info.cwd, root),
      workspaceRoots: roots,
      errors: [],
    };
  }
  if (action === 'pre_read_code') {
    return {
      toolName: 'Read',
      toolInput: { file_path: firstString(info.file_path) || '' },
      cwd: firstString(info.cwd, root),
      workspaceRoots: roots,
      errors: [],
    };
  }
  if (action === 'pre_mcp_tool_use') {
    const server = firstString(info.mcp_server_name) || 'unknown';
    const tool = firstString(info.mcp_tool_name) || 'unknown';
    return {
      toolName: `mcp__${server}__${tool}`,
      toolInput: asObject(info.mcp_tool_arguments) || info.mcp_tool_arguments || {},
      cwd: firstString(info.cwd, root),
      workspaceRoots: roots,
      errors: [],
    };
  }
  return empty([`windsurf payload has unsupported agent_action_name (${action || 'missing'})`]);
}

/**
 * GitHub Copilot: toolName/toolArgs (camelCase) or tool_name/tool_input (PascalCase PreToolUse).
 * https://docs.github.com/en/copilot/reference/hooks-reference
 */
function normalizeCopilot(input) {
  const roots = [];
  const cwd = firstString(input.cwd);
  if (cwd) roots.push(cwd);
  return {
    toolName: String(firstString(input.toolName, input.tool_name) || ''),
    toolInput: input.toolArgs !== undefined ? input.toolArgs : input.tool_input,
    cwd,
    workspaceRoots: roots,
    errors: [],
  };
}

/**
 * @param {string} host --host value
 * @param {object|null} input parsed stdin JSON
 * @returns {{ toolName: string, toolInput: *, cwd: string|null, workspaceRoots: string[], errors: string[] }}
 */
function normalizeHostPayload(host, input) {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return empty(['hook input is not a JSON object']);
  }
  switch (host) {
    case 'antigravity':
      return normalizeAntigravity(input);
    case 'windsurf':
      return normalizeWindsurf(input);
    case 'copilot':
      return normalizeCopilot(input);
    case 'kiro':
    case 'claude-code':
    case 'codex':
    case 'cursor':
    case 'opencode':
    default:
      return normalizeClaudeLike(input);
  }
}

/**
 * Write host-specific stdout for allow/deny. Claude Code / Codex / Kiro / Windsurf / OpenCode
 * block on exit code only (no stdout required). Cursor / Antigravity / Copilot need JSON.
 * Existing claude-code / cursor / codex stdout shapes must stay byte-identical.
 */
function writeHostDecision(host, decision, message, write = (s) => process.stdout.write(s)) {
  if (host === 'cursor') {
    const out =
      decision === 'deny'
        ? { permission: 'deny', user_message: message, agent_message: message }
        : { permission: 'allow' };
    write(`${JSON.stringify(out)}\n`);
    return;
  }
  if (host === 'antigravity') {
    const out =
      decision === 'deny'
        ? { decision: 'deny', reason: message || 'denied by agentic-swe policy' }
        : { decision: 'allow' };
    write(`${JSON.stringify(out)}\n`);
    return;
  }
  if (host === 'copilot') {
    if (decision === 'deny') {
      write(
        `${JSON.stringify({
          permissionDecision: 'deny',
          permissionDecisionReason: message || 'denied by agentic-swe policy',
        })}\n`
      );
    }
    return;
  }
}

module.exports = {
  normalizeHostPayload,
  writeHostDecision,
  normalizeClaudeLike,
  normalizeAntigravity,
  normalizeWindsurf,
  normalizeCopilot,
};
