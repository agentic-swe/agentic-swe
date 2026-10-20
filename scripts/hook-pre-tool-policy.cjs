#!/usr/bin/env node
/**
 * PreToolUse hook: enforce Policy-as-Code on every tool call and append the decision
 * to the active work item's audit.log (OWASP ASI02).
 *
 * stdin: host hook JSON ({ tool_name, tool_input, cwd, ... }).
 * Exit 2 = deny (stderr is shown to the model). Exit 0 = allow.
 * Hook errors fail open unless AGENTIC_SWE_POLICY_FAIL_CLOSED=1.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const packRoot = path.join(__dirname, '..');

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

function main() {
  let workDir = process.env.AGENTIC_SWE_WORK_DIR ? path.resolve(process.env.AGENTIC_SWE_WORK_DIR) : null;
  try {
    const input = JSON.parse(readStdin());
    const toolName = String(input.tool_name || '');
    if (!toolName) throw new Error('hook input has no tool_name');
    const projectRoot = path.resolve(input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
    workDir = resolveWorkDir(projectRoot);
    const state = readState(workDir);
    const currentState = state && state.current_state ? state.current_state : null;

    const { resolvePolicy } = require('./lib/policy/merge.cjs');
    const { evaluateToolCall, summarizeInput, formatAuditLine } = require('./lib/policy/runtime.cjs');
    const policy = resolvePolicy(projectRoot, packRoot);
    const verdict = evaluateToolCall({ policy, toolName, toolInput: input.tool_input, state: currentState });
    for (const w of verdict.warnings) process.stderr.write(`agentic-swe policy: ${w}\n`);

    appendAudit(
      workDir,
      formatAuditLine({
        toolName,
        decision: verdict.decision,
        state: currentState,
        rule: verdict.rule,
        input: summarizeInput(toolName, input.tool_input),
      })
    );

    if (verdict.decision === 'deny') {
      process.stderr.write(`agentic-swe policy denied ${toolName} (${verdict.rule}): ${verdict.reason}\n`);
      process.exit(2);
    }
    process.exit(0);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e).replace(/\s+/g, ' ');
    appendAudit(workDir, `${new Date().toISOString()} actor=agent action=tool_call_hook_error error="${msg.replace(/"/g, "'")}" | evidence: PreToolUse policy hook`);
    process.stderr.write(`agentic-swe policy hook error: ${msg}\n`);
    process.exit(process.env.AGENTIC_SWE_POLICY_FAIL_CLOSED === '1' ? 2 : 0);
  }
}

main();
