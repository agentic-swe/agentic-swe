'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { appendEvent, readJournal } = require('../shared/journal.cjs');
const { recordPolicyDecision } = require('../policy/record-decision.cjs');
const { redactDeep } = require('../shared/redact.cjs');
const { idempotencyKey, normalizedResult, redactText } = require('./types.cjs');
const { callerGrantInjection } = require('./grant-guard.cjs');

function outputRef(root, value, cap) {
  const text = redactText(value).slice(0, cap || 1024 * 1024);
  const sha256 = crypto.createHash('sha256').update(text).digest('hex');
  const file = path.join(root, 'tool-output', `${sha256}.txt`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, text, 'utf8');
  return { sha256, path: path.relative(root, file), bytes: Buffer.byteLength(text) };
}

function priorResult(workDir, key) {
  if (!workDir) return null;
  const chain = readJournal(workDir);
  if (!chain.ok) return null;
  for (let i = chain.events.length - 1; i >= 0; i--) {
    const event = chain.events[i];
    if (
      event.type === 'tool.completed' &&
      event.payload &&
      event.payload.result &&
      event.payload.result.idempotency_key === key
    ) {
      return event.payload.result;
    }
  }
  return null;
}

/**
 * ADR-014 §5 / ADR-009: a `tool.requested` with no matching `tool.completed`
 * means a crash happened before or during the effect. Its outcome is unknown.
 */
function orphanedRequest(workDir, key) {
  if (!workDir) return null;
  const chain = readJournal(workDir);
  if (!chain.ok) return null;
  let requested = null;
  for (const event of chain.events) {
    if (event.idempotency_key === `requested:${key}`) requested = event;
    if (event.idempotency_key === `completed:${key}`) return null;
  }
  return requested;
}

function append(workDir, type, payload, key) {
  if (!workDir) return null;
  return appendEvent(workDir, { type, payload, idempotency_key: key });
}

function policyRef(event) {
  return event ? { seq: event.seq, hash: event.hash } : null;
}

class ToolRunner {
  constructor({ registry, workDir = null, policy = null, pdp = null, actor = null, track = null, state = null } = {}) {
    if (!registry) throw new Error('ToolRunner requires a registry');
    this.registry = registry;
    this.workDir = workDir;
    this.policy = policy;
    this.pdp = pdp;
    this.actor = actor;
    this.track = track;
    this.state = state;
  }

  async run(toolId, input = {}, opts = {}) {
    const entry = this.registry.get(toolId);
    const key = idempotencyKey(toolId, input, opts.idempotency_key);
    if (!entry) {
      return normalizedResult({
        status: 'denied', tool_id: toolId, idempotency_key: key, error: { code: 'TOOL_UNREGISTERED' },
      });
    }
    const { manifest } = entry;
    const cached = manifest.idempotency === 'non-idempotent' ? priorResult(this.workDir, key) : null;
    if (cached) return cached;
    // F-M2-01: grants/permissions must come from the policy engine or approved
    // authorization state — never from caller-supplied tool input fields.
    // Checked before schema validation so injection cannot be masked as INPUT_INVALID.
    const injectedGrant = callerGrantInjection(input);
    if (injectedGrant) {
      return normalizedResult({
        tool_id: toolId, tool_version: manifest.version, idempotency_key: key,
        status: 'denied', effects: 'none',
        error: {
          code: 'DENIED_UNAUTHORIZED',
          message: `caller-supplied ${injectedGrant} is not accepted; grants come only from the policy engine`,
        },
      });
    }

    const orphan = manifest.side_effects !== 'none' ? orphanedRequest(this.workDir, key) : null;
    if (orphan) {
      append(this.workDir, 'tool.reconciled', {
        tool_id: toolId, idempotency_key: key, outcome: 'escalated',
        requested_seq: orphan.seq, side_effects: manifest.side_effects,
      }, `reconciled:${key}`);
      return normalizedResult({
        tool_id: toolId, tool_version: manifest.version, idempotency_key: key,
        status: 'error', effects: 'unknown',
        error: {
          code: 'TOOL_ORPHANED',
          message: `tool.requested at seq ${orphan.seq} has no tool.completed; side effects are unknown, so the call is not re-executed — a human must reconcile`,
        },
      });
    }

    const inputCheck = entry.validateInput(input);
    if (!inputCheck.ok) {
      return normalizedResult({
        tool_id: toolId, tool_version: manifest.version, idempotency_key: key,
        status: 'error', error: { code: inputCheck.code, message: inputCheck.errors.join('; ') },
      });
    }

    let decision = opts.decision || null;
    if (!decision) {
      if (this.pdp && typeof this.pdp.evaluate === 'function') {
        decision = this.pdp.evaluate({
          policy: opts.policy || this.policy,
          toolName: toolId,
          toolInput: input,
          track: opts.track || this.track,
          state: opts.state || this.state,
          authorized: opts.authorized,
          actor: opts.actor || this.actor || { role: 'hypervisor', source: 'runner' },
          workDir: this.workDir,
        });
      } else {
        decision = {
          decision: 'deny', rule_id: 'policy.required', policy_digest: '0'.repeat(64),
          risk_class: 'critical', reason: 'runner requires a policy decision', code: 'POLICY_REQUIRED',
          critical_failure: true,
        };
      }
    }
    const policyEvent = recordPolicyDecision({
      workDir: this.workDir,
      decision,
      toolName: toolId,
      state: opts.state || this.state,
      track: opts.track || this.track,
      toolInput: input,
      idempotency_key: `policy:${key}`,
    });
    const base = { tool_id: toolId, tool_version: manifest.version, idempotency_key: key, policy_decision_ref: policyRef(policyEvent) };
    if (decision.decision !== 'allow') {
      const denied = normalizedResult({
        ...base,
        status: decision.decision === 'require_approval' ? 'denied' : 'denied',
        pending_approval: decision.decision === 'require_approval',
        effects: 'none',
        critical_failure: decision.critical_failure === true,
        policy_rule_id: decision.rule_id || null,
        error: { code: decision.code || 'POLICY_DENIED', message: decision.reason },
      });
      append(this.workDir, 'tool.requested', { ...base, permissions: manifest.permissions, side_effects: manifest.side_effects }, `requested:${key}`);
      append(this.workDir, 'tool.completed', { ...base, result: denied }, `completed:${key}`);
      return denied;
    }

    append(this.workDir, 'tool.requested', {
      ...base, permissions: manifest.permissions, side_effects: manifest.side_effects,
    }, `requested:${key}`);
    const started = Date.now();
    const controller = new AbortController();
    let timer;
    try {
      const execution = Promise.resolve(entry.execute(input, {
        signal: controller.signal, manifest, workDir: this.workDir, opts,
      }));
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error(`tool exceeded ${manifest.timeout_ms}ms`);
          error.code = 'TOOL_TIMEOUT';
          reject(error);
        }, manifest.timeout_ms);
      });
      const raw = await Promise.race([execution, timeout]);
      clearTimeout(timer);
      const stdout = raw && raw.stdout;
      const stderr = raw && raw.stderr;
      const result = normalizedResult({
        ...base,
        status: raw && raw.status && ['ok', 'error', 'timeout'].includes(raw.status) ? raw.status : 'ok',
        duration_ms: Date.now() - started,
        effects: raw && raw.effects
          ? raw.effects
          : raw && raw.status === 'timeout'
            ? (manifest.side_effects === 'none' ? 'none' : 'unknown')
            : (manifest.side_effects === 'none' ? 'none' : 'applied'),
        partial: Boolean(raw && raw.partial),
        data: raw && Object.prototype.hasOwnProperty.call(raw, 'data') ? redactDeep(raw.data) : null,
        stdout_ref: stdout == null ? null : outputRef(this.workDir || process.cwd(), stdout, manifest.sandbox && manifest.sandbox.output_cap),
        stderr_ref: stderr == null ? null : outputRef(this.workDir || process.cwd(), stderr, manifest.sandbox && manifest.sandbox.output_cap),
        error: raw && raw.error ? raw.error : null,
      });
      append(this.workDir, 'tool.completed', { ...base, result }, `completed:${key}`);
      return result;
    } catch (error) {
      clearTimeout(timer);
      const timeout = error && error.code === 'TOOL_TIMEOUT';
      const result = normalizedResult({
        ...base,
        status: timeout ? 'timeout' : 'error',
        duration_ms: Date.now() - started,
        effects: timeout && manifest.side_effects !== 'none' ? 'unknown' : 'none',
        error: { code: error && error.code ? error.code : 'TOOL_ERROR', message: redactText(error && error.message) },
      });
      append(this.workDir, 'tool.completed', { ...base, result }, `completed:${key}`);
      return result;
    }
  }
}

async function runTool(runner, toolId, input, opts) {
  return runner.run(toolId, input, opts);
}

module.exports = { ToolRunner, runTool, outputRef };
