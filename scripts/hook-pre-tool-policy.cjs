#!/usr/bin/env node
/**
 * Pre-tool hook: enforce Policy-as-Code on every tool call and append the decision
 * to the active work item's audit.log (OWASP ASI02).
 *
 * stdin: host hook JSON ({ tool_name, tool_input, cwd, ... }).
 * Claude Code / Codex (default): exit 2 = deny (stderr is shown to the model), exit 0 = allow.
 * --host cursor: also prints {"permission":"allow"|"deny",...}; Cursor blocks on missing JSON.
 * Hook errors fail closed per scripts/lib/policy/fail-mode.cjs.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const packRoot = path.join(__dirname, '..');

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const host = argValue('--host') || 'claude-code';

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function resolveWorkDir(projectRoot) {
  if (process.env.AGENTIC_SWE_WORK_DIR) return path.resolve(process.env.AGENTIC_SWE_WORK_DIR);
  const { discoverActiveWorkDirWithMeta } = require('./lib/work-engine/discover-workdir.cjs');
  return discoverActiveWorkDirWithMeta(projectRoot).workDir || null;
}

function readState(workDir) {
  if (!workDir) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
  } catch {
    return null;
  }
}

function appendAudit(workDir, line) {
  if (!workDir || !fs.existsSync(workDir)) return;
  try {
    fs.appendFileSync(path.join(workDir, 'audit.log'), `${line}\n`, 'utf8');
  } catch {
    /* audit is best-effort; never block on it */
  }
}

function firstString(...values) {
  return values.find((v) => typeof v === 'string' && v.trim()) || null;
}

function finish(decision, message) {
  if (host === 'cursor') {
    const out = decision === 'deny'
      ? { permission: 'deny', user_message: message, agent_message: message }
      : { permission: 'allow' };
    process.stdout.write(`${JSON.stringify(out)}\n`);
  }
  if (message) process.stderr.write(`${message}\n`);
  process.exit(decision === 'deny' ? 2 : 0);
}

function main() {
  const errors = [];
  let input = null;
  try {
    input = JSON.parse(readStdin());
  } catch (e) {
    errors.push(`hook input is not JSON (${e.message})`);
  }
  if (input !== null && (typeof input !== 'object' || Array.isArray(input))) {
    errors.push('hook input is not a JSON object');
    input = null;
  }
  const toolName = input ? String(input.tool_name || '') : '';
  if (input && !toolName) errors.push('hook input has no tool_name');

  const roots = input && Array.isArray(input.workspace_roots) ? input.workspace_roots : [];
  const projectRoot = path.resolve(
    firstString(input && input.cwd, roots[0], process.env.CURSOR_PROJECT_DIR, process.env.CLAUDE_PROJECT_DIR) || process.cwd()
  );

  let workDir = process.env.AGENTIC_SWE_WORK_DIR ? path.resolve(process.env.AGENTIC_SWE_WORK_DIR) : null;
  try {
    workDir = resolveWorkDir(projectRoot);
  } catch (e) {
    errors.push(`work item discovery failed (${e.message})`);
  }
  const state = readState(workDir);
  const currentState = state && state.current_state ? state.current_state : null;

  let verdict = null;
  let summary = '';
  try {
    const { resolvePolicyChecked } = require('./lib/policy/merge.cjs');
    const { evaluateToolCall, summarizeInput } = require('./lib/policy/runtime.cjs');
    const resolved = resolvePolicyChecked(projectRoot, packRoot);
    errors.push(...resolved.errors);
    if (toolName) {
      verdict = evaluateToolCall({ policy: resolved.policy, toolName, toolInput: input.tool_input, state: currentState });
      summary = summarizeInput(toolName, input.tool_input);
      for (const w of verdict.warnings) process.stderr.write(`agentic-swe policy: ${w}\n`);
    }
  } catch (e) {
    errors.push(String(e && e.message ? e.message : e));
  }

  if (toolName && verdict && verdict.decision !== 'deny') {
    try {
      const roles = require('./lib/policy/roles.cjs');
      const loaded = roles.loadRoles(process.env.AGENTIC_SWE_ROLES_DIR || undefined);
      errors.push(...loaded.errors);
      const actor = roles.resolveActor({ roles: loaded.roles, agentType: input.agent_type, hasWorkItem: Boolean(workDir) });
      if (actor.error) errors.push(actor.error);
      const auth = roles.readAuthorizations(workDir);
      if (auth.error) errors.push(auth.error);
      const roleVerdict = roles.evaluateRoleCall({
        roles: loaded.roles,
        actor,
        toolName,
        toolInput: input.tool_input,
        authorized: auth.actions,
      });
      if (roleVerdict.decision === 'deny') verdict = { ...verdict, ...roleVerdict };
    } catch (e) {
      errors.push(`role check failed (${e && e.message ? e.message : e})`);
    }
  }

  const { formatAuditLine } = require('./lib/policy/runtime.cjs');
  if (verdict && verdict.decision === 'deny') {
    appendAudit(workDir, formatAuditLine({ toolName, decision: 'deny', state: currentState, rule: verdict.rule, input: summary }));
    finish('deny', `agentic-swe policy denied ${toolName} (${verdict.rule}): ${verdict.reason}`);
  }

  if (errors.length > 0) {
    const { hookErrorMode } = require('./lib/policy/fail-mode.cjs');
    const mode = hookErrorMode({ hasWorkItem: Boolean(workDir), state, projectRoot });
    const msg = errors.join('; ').replace(/\s+/g, ' ');
    const decision = mode.closed ? 'deny' : 'allow';
    appendAudit(
      workDir,
      `${new Date().toISOString()} actor=agent action=tool_call_hook_error tool=${toolName || 'unknown'} decision=${decision} mode=${mode.closed ? 'fail-closed' : 'fail-open'} state=${currentState || 'none'} error="${msg.replace(/"/g, "'")}" | evidence: pre-tool policy hook`
    );
    if (mode.closed) finish('deny', `agentic-swe policy hook error (fail-closed: ${mode.why}): ${msg}`);
    finish('allow', `agentic-swe policy hook error (fail-open: ${mode.why}; set policy.fail_closed in .agentic-swe/runtime.json to deny): ${msg}`);
  }

  appendAudit(workDir, formatAuditLine({ toolName, decision: 'allow', state: currentState, rule: undefined, input: summary }));
  finish('allow', '');
}

main();
