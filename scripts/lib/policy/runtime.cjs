'use strict';

/**
 * Runtime evaluation of Policy-as-Code for a single tool call (OWASP ASI02).
 * Pure: no filesystem access except the one-time state list load.
 */

const path = require('node:path');
const { minimatch } = require('minimatch');
const { redactSecrets } = require('../memory/session-capture.cjs');

const SHELL_TOOLS = new Set(['Bash', 'Shell', 'run_shell_command', 'shell', 'local_shell']);
const SUMMARY_MAX = 160;
const PATTERN_MAX = 512;

function patternOk(pattern) {
  return typeof pattern === 'string' && pattern.length > 0 && pattern.length <= PATTERN_MAX;
}

let cachedStates = null;
function knownStates() {
  if (cachedStates) return cachedStates;
  try {
    const sm = require(path.join(__dirname, '..', '..', '..', 'state-machine.json'));
    cachedStates = new Set(sm.edges.flat());
  } catch {
    cachedStates = new Set();
  }
  return cachedStates;
}

function extractCommand(toolName, toolInput) {
  if (!SHELL_TOOLS.has(toolName) || !toolInput) return null;
  const c = toolInput.command != null ? toolInput.command : toolInput.cmd;
  if (Array.isArray(c)) return c.map(String).join(' ');
  return typeof c === 'string' ? c : null;
}

const EDIT_TOOL_RE = /write|edit|replace|patch|delete|create|move|rename|notebook/i;
const PATH_KEYS = ['file_path', 'path', 'target_file', 'notebook_path', 'target_notebook', 'filePath', 'filename', 'destination', 'new_path', 'old_path'];
const PATCH_FILE_RE = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm;

/** Paths an edit-capable tool call would modify, as given in its input. */
function extractTargetPaths(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object' || SHELL_TOOLS.has(toolName) || !EDIT_TOOL_RE.test(toolName)) return [];
  const out = [];
  const add = (v) => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  };
  for (const k of PATH_KEYS) add(toolInput[k]);
  if (Array.isArray(toolInput.paths)) toolInput.paths.forEach(add);
  if (Array.isArray(toolInput.edits)) for (const e of toolInput.edits) if (e && typeof e === 'object') add(e.file_path || e.path);
  for (const key of ['command', 'patch', 'input']) {
    if (typeof toolInput[key] !== 'string') continue;
    for (const m of toolInput[key].matchAll(PATCH_FILE_RE)) add(m[1]);
  }
  return out;
}

function normalizeTarget(p) {
  return path.posix
    .normalize(p.replace(/\\/g, '/'))
    .replace(/^[A-Za-z]:\//, '')
    .replace(/^(?:\/|\.\.\/|\.\/)+/, '');
}

function ruleLabel(field, i, entry) {
  return typeof entry.id === 'string' && entry.id ? `${field}[${entry.id}]` : `${field}[${i}]`;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandPrefixRe(prefix) {
  const body = prefix.trim().split(/\s+/).map(escapeRe).join('\\s+');
  return new RegExp(`(^|[\\s;&|(])${body}(\\s|$)`);
}

function appliesInState(stateScope, state) {
  if (!stateScope || stateScope.length === 0) return true;
  return state != null && stateScope.includes(state);
}

/**
 * @param {{ policy: object, toolName: string, toolInput?: object, state?: string|null }} p
 * @returns {{ decision: 'allow'|'deny', rule?: string, reason?: string, warnings: string[] }}
 */
function evaluateToolCall({ policy, toolName, toolInput, state }) {
  const warnings = [];
  const pol = policy || {};
  const command = extractCommand(toolName, toolInput);
  const deny = (rule, reason) => ({ decision: 'deny', rule, reason, warnings });

  for (const [i, entry] of (pol.banned_tools || []).entries()) {
    if (!entry || typeof entry.tool !== 'string' || !entry.tool.trim()) continue;
    const scope = entry.context && knownStates().has(entry.context) ? [entry.context] : null;
    if (!appliesInState(scope, state)) continue;
    if (!patternOk(entry.tool)) {
      warnings.push(`banned_tools[${i}] skipped: pattern exceeds ${PATTERN_MAX} characters`);
      continue;
    }
    const isCommand = /\s/.test(entry.tool.trim());
    const hit = isCommand
      ? command != null && commandPrefixRe(entry.tool).test(command)
      : minimatch(toolName, entry.tool);
    if (hit) return deny(ruleLabel('banned_tools', i, entry), entry.reason || `banned: ${entry.tool}`);
  }

  if (command != null) {
    for (const [i, entry] of (pol.banned_commands || []).entries()) {
      if (!entry || typeof entry.pattern !== 'string') continue;
      if (!patternOk(entry.pattern)) {
        warnings.push(`banned_commands[${i}] skipped: pattern exceeds ${PATTERN_MAX} characters`);
        continue;
      }
      if (!appliesInState(entry.states, state)) continue;
      let re;
      try {
        re = new RegExp(entry.pattern);
      } catch (e) {
        warnings.push(`banned_commands[${i}] skipped: invalid regex (${e.message})`);
        continue;
      }
      if (re.test(command)) return deny(ruleLabel('banned_commands', i, entry), entry.reason || `banned command: ${entry.pattern}`);
    }
  }

  const targets = extractTargetPaths(toolName, toolInput).map(normalizeTarget);
  if (targets.length > 0) {
    for (const [i, entry] of (pol.protected_paths || []).entries()) {
      if (!entry || !patternOk(entry.pattern)) continue;
      const hit = targets.find((t) => minimatch(t, entry.pattern, { dot: true }));
      if (hit) return deny(ruleLabel('protected_paths', i, entry), `${entry.reason || 'protected path'} (${hit})`);
    }
  }

  const allow = state != null && pol.phase_tool_allowlist ? pol.phase_tool_allowlist[state] : null;
  if (Array.isArray(allow) && !allow.some((g) => patternOk(g) && minimatch(toolName, g))) {
    return deny(
      `phase_tool_allowlist.${state}`,
      `${toolName} is not allowed during ${state} (allowed: ${allow.join(', ') || 'none'})`
    );
  }

  return { decision: 'allow', warnings };
}

function summarizeInput(toolName, toolInput) {
  let s;
  const command = extractCommand(toolName, toolInput);
  if (command != null) s = command;
  else if (toolInput && typeof toolInput === 'object') {
    const key = ['file_path', 'path', 'target_file', 'url', 'pattern', 'query'].find((k) => typeof toolInput[k] === 'string');
    s = key ? `${key}=${toolInput[key]}` : `keys=${Object.keys(toolInput).join(',')}`;
  } else s = '';
  s = redactSecrets(s.replace(/\s+/g, ' ').trim()).redacted.replace(/"/g, "'");
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s;
}

function formatAuditLine({ at, toolName, decision, state, rule, input }) {
  const parts = [
    at || new Date().toISOString(),
    'actor=agent',
    'action=tool_call',
    `tool=${toolName}`,
    `decision=${decision}`,
    `state=${state || 'none'}`,
  ];
  if (rule) parts.push(`rule=${rule}`);
  parts.push(`input="${input}"`);
  return `${parts.join(' ')} | evidence: PreToolUse policy hook`;
}

module.exports = {
  SHELL_TOOLS,
  extractCommand,
  extractTargetPaths,
  normalizeTarget,
  evaluateToolCall,
  summarizeInput,
  formatAuditLine,
};
