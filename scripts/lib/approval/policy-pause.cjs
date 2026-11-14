'use strict';

/**
 * AE-039b / PD-57: pause/resume human gate for PDP `require_approval`.
 *
 * When a tool call needs approval, write a request artifact and block execution
 * until a matching human (`user:`) approval record exists. Missing or forged
 * approvals do not resume. Does not change PDP baseline or default-policy.json.
 *
 * Layer: approval (core).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REQUEST_FILE = 'policy-approval-request.json';
const RECORD_FILE = 'policy-approval-record.json';

/**
 * Stable request id from the decision surface (not caller grants).
 * @param {{
 *   toolName?: string,
 *   rule_id?: string,
 *   policy_digest?: string,
 *   input_summary?: string,
 *   reason?: string,
 * }} parts
 * @returns {string}
 */
function requestId(parts = {}) {
  const canonical = JSON.stringify({
    tool_name: String(parts.toolName || ''),
    rule_id: String(parts.rule_id || ''),
    policy_digest: String(parts.policy_digest || ''),
    input_summary: String(parts.input_summary || ''),
    reason: String(parts.reason || ''),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write (or refresh) the pending approval request for this require_approval hit.
 * @returns {{ ok: true, request: object } | { ok: false, reason: string }}
 */
function writeApprovalRequest({ workDir, toolName, decision }) {
  if (!workDir || typeof workDir !== 'string' || !workDir.trim()) {
    return { ok: false, reason: 'require_approval pause needs a workDir to store the request artifact' };
  }
  if (!decision || decision.decision !== 'require_approval') {
    return { ok: false, reason: 'writeApprovalRequest only accepts require_approval decisions' };
  }
  const abs = path.resolve(workDir.trim());
  const id = requestId({
    toolName,
    rule_id: decision.rule_id,
    policy_digest: decision.policy_digest,
    input_summary: decision.input_summary,
    reason: decision.reason,
  });
  const request = {
    schema_version: 1,
    id,
    created_at: new Date().toISOString(),
    tool_name: String(toolName || ''),
    rule_id: String(decision.rule_id || ''),
    policy_digest: String(decision.policy_digest || ''),
    input_summary: String(decision.input_summary || ''),
    reason: String(decision.reason || ''),
    risk_class: decision.risk_class || null,
    code: decision.code || null,
  };
  try {
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, REQUEST_FILE), JSON.stringify(request, null, 2) + '\n');
  } catch (e) {
    return { ok: false, reason: `failed to write ${REQUEST_FILE}: ${e.message}` };
  }
  return { ok: true, request };
}

/**
 * Validate a human approval record against the current request.
 * Fail closed on missing, unreadable, forged actor, or id mismatch.
 *
 * @returns {{ ok: true, record: object } | { ok: false, reason: string }}
 */
function readMatchingApproval({ workDir, request }) {
  if (!workDir || !request || !request.id) {
    return { ok: false, reason: 'no approval request to match' };
  }
  const file = path.join(path.resolve(workDir), RECORD_FILE);
  const record = readJson(file);
  if (!record || typeof record !== 'object') {
    return { ok: false, reason: `${RECORD_FILE} missing or unreadable` };
  }
  if (record.decision !== 'approved') {
    return { ok: false, reason: `approval decision is "${record.decision || ''}", not approved` };
  }
  if (typeof record.actor !== 'string' || !record.actor.startsWith('user:')) {
    return { ok: false, reason: 'approval actor is not a user: identity (forged or agent)' };
  }
  if (record.request_id !== request.id) {
    return { ok: false, reason: 'approval request_id does not match the pending request' };
  }
  return { ok: true, record };
}

/**
 * Record a human approval for the pending request. Caller must supply a user: identity
 * (tests/CLI); never accepts agent-forged actors.
 *
 * @returns {{ ok: true, record: object } | { ok: false, reason: string }}
 */
function recordPolicyToolApproval({ workDir, identity, note = '' }) {
  if (!workDir || typeof workDir !== 'string' || !workDir.trim()) {
    return { ok: false, reason: 'workDir required' };
  }
  if (!identity || typeof identity.actor !== 'string' || !identity.actor.startsWith('user:')) {
    return { ok: false, reason: 'identity.actor must be a user: principal' };
  }
  const abs = path.resolve(workDir.trim());
  const request = readJson(path.join(abs, REQUEST_FILE));
  if (!request || !request.id) {
    return { ok: false, reason: `${REQUEST_FILE} missing; nothing to approve` };
  }
  const record = {
    schema_version: 1,
    request_id: request.id,
    decision: 'approved',
    actor: identity.actor,
    at: new Date().toISOString(),
    note: note || '',
    tool_name: request.tool_name || '',
    rule_id: request.rule_id || '',
  };
  try {
    fs.writeFileSync(path.join(abs, RECORD_FILE), JSON.stringify(record, null, 2) + '\n');
    fs.appendFileSync(
      path.join(abs, 'audit.log'),
      `${record.at} actor=${record.actor} action=policy_tool_approval decision=approved request_id=${record.request_id} tool=${record.tool_name} rule=${record.rule_id} | evidence: ${RECORD_FILE}\n`
    );
  } catch (e) {
    return { ok: false, reason: `failed to write ${RECORD_FILE}: ${e.message}` };
  }
  return { ok: true, record };
}

/**
 * Consume a require_approval PDP decision: pause (write request) or resume (matched approval).
 *
 * @returns {{
 *   resumed: boolean,
 *   paused: boolean,
 *   reason: string,
 *   request?: object,
 *   record?: object,
 * }}
 */
function resolveRequireApproval({ workDir, toolName, decision }) {
  if (!decision || decision.decision !== 'require_approval') {
    return { resumed: false, paused: false, reason: 'not a require_approval decision' };
  }
  const written = writeApprovalRequest({ workDir, toolName, decision });
  if (!written.ok) {
    return {
      resumed: false,
      paused: true,
      reason: `require_approval blocked (fail closed): ${written.reason}`,
    };
  }
  const match = readMatchingApproval({ workDir, request: written.request });
  if (match.ok) {
    return {
      resumed: true,
      paused: false,
      reason: `human approved require_approval (${decision.rule_id}) as ${match.record.actor}`,
      request: written.request,
      record: match.record,
    };
  }
  return {
    resumed: false,
    paused: true,
    reason: `paused for human approval (${decision.rule_id}): ${match.reason}. Record approval with policy-approval-record.json matching request id ${written.request.id}`,
    request: written.request,
  };
}

module.exports = {
  REQUEST_FILE,
  RECORD_FILE,
  requestId,
  writeApprovalRequest,
  readMatchingApproval,
  recordPolicyToolApproval,
  resolveRequireApproval,
};
