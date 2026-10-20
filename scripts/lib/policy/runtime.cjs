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
    const isCommand = /\s/.test(entry.tool.trim());
    const hit = isCommand
      ? command != null && commandPrefixRe(entry.tool).test(command)
      : minimatch(toolName, entry.tool);
    if (hit) return deny(`banned_tools[${i}]`, entry.reason || `banned: ${entry.tool}`);
  }

  if (command != null) {
    for (const [i, entry] of (pol.banned_commands || []).entries()) {
      if (!entry || typeof entry.pattern !== 'string') continue;
      if (!appliesInState(entry.states, state)) continue;
      let re;
      try {
        re = new RegExp(entry.pattern);
      } catch (e) {
        warnings.push(`banned_commands[${i}] skipped: invalid regex (${e.message})`);
        continue;
      }
      if (re.test(command)) return deny(`banned_commands[${i}]`, entry.reason || `banned command: ${entry.pattern}`);
    }
  }

  const allow = state != null && pol.phase_tool_allowlist ? pol.phase_tool_allowlist[state] : null;
  if (Array.isArray(allow) && !allow.some((g) => minimatch(toolName, g))) {
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
  evaluateToolCall,
  summarizeInput,
  formatAuditLine,
};
