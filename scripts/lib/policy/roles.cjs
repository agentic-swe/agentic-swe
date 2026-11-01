'use strict';

/**
 * Agent roles (config/roles/*.json): which tools a role may call and which privileged
 * actions it may take once a human authorization record exists.
 */

const fs = require('node:fs');
const path = require('node:path');
const { minimatch } = require('minimatch');

const PACK_ROOT = path.join(__dirname, '..', '..', '..');
const AUTHORIZATION_FILE = 'authorization-record.json';
const PRIVILEGED_ACTIONS = ['github.branch.push', 'github.pr.write', 'npm.publish'];

const TOOL_CLASSES = {
  read: ['Read', 'NotebookRead', 'read_file', 'ReadFile', 'view_image'],
  search: ['Grep', 'Glob', 'LS', 'list_dir', 'file_search', 'grep_search', 'codebase_search', 'SemanticSearch'],
  edit: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'EditNotebook', 'StrReplace', 'Delete', 'apply_patch', 'write_file', 'edit_file', 'replace'],
  shell: ['Bash', 'BashOutput', 'KillBash', 'KillShell', 'Shell', 'AwaitShell', 'run_shell_command', 'shell', 'local_shell', 'exec_command', 'write_stdin'],
  web: ['WebFetch', 'WebSearch', 'web_search', 'web_fetch'],
  spawn: ['Task', 'Agent'],
  mcp: ['mcp__*', 'MCP:*', 'ListMcpResourcesTool', 'ReadMcpResourceTool', 'FetchMcpResource'],
  plan: ['TodoWrite', 'TodoRead', 'update_plan', 'ExitPlanMode', 'AskUserQuestion', 'AskQuestion', 'Skill', 'SlashCommand'],
};

const SHELL_TOOLS = new Set(TOOL_CLASSES.shell);
const GIT_PUSH_RE = /(?:^|[\s;&|(])git\s+(?:(?:-c\s+(?:'[^']*'|"[^"]*"|\S+)|-C\s+\S+|--?[A-Za-z][\w-]*(?:=\S+)?)\s+)*push\b([^\n]*)/;
const GH_PR_WRITE_RE = /(?:^|[\s;&|(])gh\s+(?:-R\s+\S+\s+|--repo\s+\S+\s+)?pr\s+(?:create|merge|edit|close|reopen|comment|review|ready|lock|unlock|update-branch)\b/;
const GH_API_RE = /(?:^|[\s;&|(])gh\s+api\b([^\n]*)/;
const GH_API_METHOD_RE = /(?:^|\s)(?:-X|--method)(?:\s+|=)?['"]?([A-Za-z]+)/;
const GH_API_FIELD_RE = /(?:^|\s)(?:-[fF]|--field|--raw-field|--input)(?=[\s=]|$)/;
const NPM_PUBLISH_RE = /(?:^|[\s;&|(])(?:(?:npm|pnpm)\s+(?:[^\n]*\s)?publish|yarn\s+(?:npm\s+)?publish)(?=\s|$|[;&|)])/;
const MCP_PUSH_RE = /(?:^|_)(?:push_files|create_branch|create_or_update_file|delete_file|git_push)$/;
const MCP_PR_WRITE_RE = /(?:^|_)(?:create|merge|update|submit|add|delete)_(?:[a-z_]*_)?pull_request|pull_request_(?:create|merge|update)|request_copilot_review/;

let schemaValidator = null;
function validateRole(role) {
  if (!schemaValidator) {
    const Ajv = require('ajv').default;
    const schema = JSON.parse(fs.readFileSync(path.join(PACK_ROOT, 'schemas', 'role-definition.schema.json'), 'utf8'));
    schemaValidator = new Ajv({ allErrors: true, strict: false }).compile(schema);
  }
  if (schemaValidator(role)) return [];
  return schemaValidator.errors.map((e) => `${e.instancePath || '/'} ${e.message}`);
}

/**
 * @param {string} [dir] defaults to <pack>/config/roles
 * @returns {{ roles: Map<string, object>, errors: string[] }}
 */
function loadRoles(dir = path.join(PACK_ROOT, 'config', 'roles')) {
  const roles = new Map();
  const errors = [];
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (e) {
    return { roles, errors: [`role directory ${dir} is unreadable: ${e.message}`] };
  }
  for (const f of files) {
    let role;
    try {
      role = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      errors.push(`role ${f} is not valid JSON: ${e.message}`);
      continue;
    }
    const v = validateRole(role);
    if (v.length) {
      errors.push(`role ${f} is invalid: ${v.join('; ')}`);
      continue;
    }
    if (`${role.id}.json` !== f) {
      errors.push(`role ${f} has id "${role.id}"; the file must be ${role.id}.json`);
      continue;
    }
    roles.set(role.id, role);
  }
  if (!roles.has('hypervisor')) errors.push('config/roles has no hypervisor role');
  return { roles, errors };
}

function agentTypeKey(agentType) {
  return String(agentType || '').replace(/^[^:]+:/, '');
}

/**
 * Who is calling: AGENTIC_SWE_ROLE, else the host's agent_type mapped through
 * role.agent_types, else the hypervisor when a work item is active.
 * @returns {{ role: string|null, agentType: string|null, source: string, error?: string }}
 */
function resolveActor({ roles, env = process.env, agentType, hasWorkItem }) {
  const explicit = typeof env.AGENTIC_SWE_ROLE === 'string' ? env.AGENTIC_SWE_ROLE.trim() : '';
  const type = typeof agentType === 'string' && agentType.trim() ? agentType.trim() : null;
  if (explicit) {
    if (!roles.has(explicit)) return { role: explicit, agentType: type, source: 'env', error: `AGENTIC_SWE_ROLE "${explicit}" is not a role in config/roles` };
    return { role: explicit, agentType: type, source: 'env' };
  }
  if (type) {
    const key = agentTypeKey(type);
    for (const role of roles.values()) {
      if (role.agent_types.includes(key)) return { role: role.id, agentType: type, source: 'agent_type' };
    }
    return { role: null, agentType: type, source: 'agent_type' };
  }
  if (hasWorkItem) return { role: 'hypervisor', agentType: null, source: 'work_item' };
  return { role: null, agentType: null, source: 'none' };
}

function toolAllowed(role, toolName) {
  return role.tools.some((entry) => {
    const globs = TOOL_CLASSES[entry] || [entry];
    return globs.some((g) => minimatch(toolName, g));
  });
}

/** Split on ; && || | and newlines outside quotes, so quoted -c values stay in one segment. */
function splitShellSegments(command) {
  const segments = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) {
        cur += ch + command[++i];
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '|' || (ch === '&' && command[i + 1] === '&')) {
      if (ch === '&' || (ch === '|' && command[i + 1] === '|')) i++;
      segments.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  segments.push(cur);
  return segments;
}

function shellCommand(toolName, toolInput) {
  if (!SHELL_TOOLS.has(toolName) || !toolInput) return null;
  const c = toolInput.command != null ? toolInput.command : toolInput.cmd;
  if (Array.isArray(c)) return c.map(String).join(' ');
  return typeof c === 'string' ? c : null;
}

/**
 * Privileged actions a tool call would take, from shell text or the tool name.
 * Shell matching is textual; `git push --dry-run` is not a push.
 * @returns {string[]}
 */
function privilegedActions(toolName, toolInput) {
  const out = new Set();
  const command = shellCommand(toolName, toolInput);
  if (command != null) {
    for (const segment of splitShellSegments(command)) {
      const push = segment.match(GIT_PUSH_RE);
      if (push && !/(?:^|\s)--dry-run(?=\s|$)/.test(push[1])) out.add('github.branch.push');
      if (GH_PR_WRITE_RE.test(segment)) out.add('github.pr.write');
      const api = segment.match(GH_API_RE);
      const method = api && api[1].match(GH_API_METHOD_RE);
      const writes = api && (method ? method[1].toUpperCase() !== 'GET' : GH_API_FIELD_RE.test(api[1]));
      if (writes) {
        if (/\/(?:git\/(?:refs|commits|trees|blobs|tags)|contents|merges|branches)\b/.test(api[1])) out.add('github.branch.push');
        if (/\/(?:pulls|issues)\b/.test(api[1])) out.add('github.pr.write');
      }
      if (NPM_PUBLISH_RE.test(segment)) out.add('npm.publish');
    }
  } else {
    const name = String(toolName || '').toLowerCase();
    if (MCP_PUSH_RE.test(name)) out.add('github.branch.push');
    if (MCP_PR_WRITE_RE.test(name)) out.add('github.pr.write');
  }
  return [...out];
}

/**
 * Actions a human has authorized for this work item (`work authorize`).
 * @returns {{ actions: Set<string>, error?: string }}
 */
function readAuthorizations(workDir) {
  const actions = new Set();
  if (!workDir) return { actions };
  const file = path.join(workDir, AUTHORIZATION_FILE);
  if (!fs.existsSync(file)) return { actions };
  let rec;
  try {
    rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { actions, error: `${AUTHORIZATION_FILE} is unreadable: ${e.message}` };
  }
  for (const g of (rec && Array.isArray(rec.grants) ? rec.grants : [])) {
    if (g && PRIVILEGED_ACTIONS.includes(g.action) && typeof g.actor === 'string' && g.actor.startsWith('user:')) {
      actions.add(g.action);
    }
  }
  return { actions };
}

/**
 * Add or revoke a grant in authorization-record.json and append an audit line.
 * Callers must have verified a human context (detectAgentContext).
 */
function recordAuthorization({ workDir, action, identity, note, revoke = false }) {
  if (!PRIVILEGED_ACTIONS.includes(action)) {
    return { ok: false, code: 'BAD_ACTION', message: `action must be one of: ${PRIVILEGED_ACTIONS.join(', ')}` };
  }
  if (!identity || typeof identity.actor !== 'string' || !identity.actor.startsWith('user:')) {
    return { ok: false, code: 'NO_IDENTITY', message: 'cannot resolve user identity (git user.email or OS user)' };
  }
  const file = path.join(workDir, AUTHORIZATION_FILE);
  let rec = { grants: [], revoked: [] };
  if (fs.existsSync(file)) {
    try {
      rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      return { ok: false, code: 'RECORD_UNREADABLE', message: `${AUTHORIZATION_FILE} is unreadable: ${e.message}` };
    }
  }
  const grants = Array.isArray(rec.grants) ? rec.grants : [];
  const revoked = Array.isArray(rec.revoked) ? rec.revoked : [];
  const at = new Date().toISOString();
  const entry = { action, actor: identity.actor, at, note: note || '' };
  const next = revoke
    ? { grants: grants.filter((g) => !g || g.action !== action), revoked: [...revoked, entry] }
    : { grants: [...grants.filter((g) => !g || g.action !== action), entry], revoked };
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  fs.appendFileSync(
    path.join(workDir, 'audit.log'),
    `${at} actor=${identity.actor} action=${revoke ? 'authorization_revoked' : 'authorization_granted'} privileged=${action}${note ? ` note="${String(note).replace(/"/g, "'")}"` : ''} | evidence: ${AUTHORIZATION_FILE}\n`
  );
  return { ok: true, action, revoked: revoke, record: next };
}

/**
 * @param {object} p
 * @param {Map<string, object>} p.roles
 * @param {{ role: string|null, agentType: string|null }} p.actor
 * @param {string} p.toolName
 * @param {object} p.toolInput
 * @param {Set<string>} p.authorized
 * @returns {{ decision: 'allow'|'deny', rule?: string, reason?: string }}
 */
function evaluateRoleCall({ roles, actor, toolName, toolInput, authorized }) {
  const role = actor.role ? roles.get(actor.role) : null;
  if (!role && !actor.agentType && !actor.role) return { decision: 'allow' };

  if (role && !toolAllowed(role, toolName)) {
    return {
      decision: 'deny',
      rule: `role[${role.id}].tools`,
      reason: `role ${role.id} may not call ${toolName} (allowed: ${role.tools.join(', ')})`,
    };
  }

  for (const action of privilegedActions(toolName, toolInput)) {
    const who = role ? `role ${role.id}` : `agent ${actor.agentType || actor.role} (no role in config/roles)`;
    if (!role || !role.privileged_actions.includes(action)) {
      return { decision: 'deny', rule: `privileged[${action}]`, reason: `${who} may not perform ${action}` };
    }
    if (!authorized.has(action)) {
      return {
        decision: 'deny',
        rule: `privileged[${action}]`,
        reason: `${action} needs a human authorization record: run \`agentic-swe work authorize --action ${action}\``,
      };
    }
  }
  return { decision: 'allow' };
}

module.exports = {
  AUTHORIZATION_FILE,
  PRIVILEGED_ACTIONS,
  TOOL_CLASSES,
  loadRoles,
  validateRole,
  resolveActor,
  toolAllowed,
  privilegedActions,
  readAuthorizations,
  recordAuthorization,
  evaluateRoleCall,
};
