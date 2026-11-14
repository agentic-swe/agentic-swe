'use strict';

const { evaluateToolCall, extractCommand, extractTargetPaths, summarizeInput } = require('./runtime.cjs');
const { evaluateRoleCall, privilegedActions, readAuthorizations, loadRoles, resolveActor } = require('./roles.cjs');
const { policyDigest } = require('./digest.cjs');
const { matchRestrictedOp } = require('./restricted-ops.cjs');
const { classifyRisk, humanGateRequired } = require('./risk-class.cjs');
const { evaluateSelfImprovementMergeDeploy } = require('./self-improvement-gate.cjs');
const { extractOrgScopedContext, evaluateOrgAccess } = require('./org-rbac.cjs');
const { redactDeep } = require('../shared/redact.cjs');

/** Providers treated as local / $0 (PD-14 / PD-15). */
const LOCAL_PROVIDERS = new Set(['fixture', 'ollama', 'llamacpp', 'llama.cpp', 'local']);

/**
 * @typedef {{
 *   decision: 'allow'|'deny'|'require_approval',
 *   rule_id: string,
 *   policy_digest: string,
 *   risk_class: 'low'|'medium'|'high'|'critical',
 *   reason: string,
 *   input_summary: string,
 *   warnings: string[],
 *   code?: string,
 *   critical_failure?: boolean,
 * }} PolicyDecision
 */

/**
 * @param {object} policy
 * @param {{ pinned_digest?: string|null }} [opts]
 * @returns {{ ok: true, digest: string } | { ok: false, decision: PolicyDecision }}
 */
function assertPolicyReady(policy, opts = {}) {
  if (policy == null || typeof policy !== 'object' || Array.isArray(policy)) {
    return {
      ok: false,
      decision: decideCritical('policy.invalid', 'policy object is missing or invalid', '', 'critical'),
    };
  }
  let digest;
  try {
    digest = policyDigest(policy);
  } catch (err) {
    return {
      ok: false,
      decision: decideCritical(
        'policy.digest_error',
        `failed to compute policy digest: ${err.message}`,
        '',
        'critical'
      ),
    };
  }
  if (opts.pinned_digest && opts.pinned_digest !== digest) {
    return {
      ok: false,
      decision: decideCritical(
        'policy.digest_mismatch',
        `policy digest ${digest.slice(0, 12)}… differs from pinned ${String(opts.pinned_digest).slice(0, 12)}…`,
        digest,
        'critical'
      ),
    };
  }
  return { ok: true, digest };
}

function decideCritical(rule_id, reason, digest, risk_class) {
  return {
    decision: 'deny',
    rule_id,
    policy_digest: digest || '',
    risk_class,
    reason,
    input_summary: '',
    warnings: [],
    code: 'POLICY_CRITICAL',
    critical_failure: true,
  };
}

function finish(base) {
  return {
    warnings: [],
    input_summary: '',
    ...base,
  };
}

/**
 * Sum paid USD from usage.recorded-shaped events (cost_source !== local).
 * Local / fixture usage never counts against a zero paid-spend allowance.
 *
 * @param {Array<{ payload?: object }|object>} events
 * @returns {{ paid_usd: number, local_usd: number, tool_calls: number }}
 */
function summarizeUsage(events) {
  let paid_usd = 0;
  let local_usd = 0;
  let tool_calls = 0;
  for (const ev of events || []) {
    const p = ev && ev.payload ? ev.payload : ev;
    if (!p || typeof p !== 'object') continue;
    if (p.status === 'ok' || p.tool_id) tool_calls += 1;
    const usd = typeof p.usd === 'number' ? p.usd : 0;
    if (p.cost_source === 'local' || LOCAL_PROVIDERS.has(String(p.provider || ''))) {
      local_usd += usd;
    } else if (usd > 0 || p.cost_source === 'price_table' || p.cost_source === 'provider') {
      paid_usd += usd > 0 ? usd : 0;
    }
  }
  return { paid_usd, local_usd, tool_calls };
}

/**
 * Pure PDP evaluation.
 *
 * @param {{
 *   policy: object,
 *   toolName?: string,
 *   toolInput?: object,
 *   state?: string|null,
 *   track?: string|null,
 *   op?: string|null,
 *   flags?: object,
 *   provider?: string|null,
 *   model?: string|null,
 *   cost_source?: string|null,
 *   usage_events?: object[],
 *   paid_spend_allowance_usd?: number,
 *   max_tool_calls?: number|null,
 *   max_wall_ms?: number|null,
 *   wall_ms_used?: number,
 *   authorized?: Set<string>|string[],
 *   roles?: Map<string, object>|null,
 *   actor?: object|null,
 *   workDir?: string|null,
 *   riskFlags?: object|null,
 *   pinned_digest?: string|null,
 *   paths?: string[],
 *   transition?: { from?: string, to?: string }|null,
 *   mode?: string|null,
 *   tenant_id?: string|null,
 *   org_id?: string|null,
 *   team_id?: string|null,
 *   project_id?: string|null,
 *   principal?: string|null,
 *   action?: string|null,
 *   orgRbacDir?: string|null,
 *   projectRoot?: string|null,
 * }} input
 * @returns {PolicyDecision}
 */
function evaluate(input) {
  try {
    return evaluateInner(input || {});
  } catch (err) {
    return decideCritical(
      'policy.evaluator_exception',
      `evaluator exception: ${err && err.message ? err.message : String(err)}`,
      '',
      'critical'
    );
  }
}

function evaluateInner(input) {
  const ready = assertPolicyReady(input.policy, { pinned_digest: input.pinned_digest });
  if (!ready.ok) return ready.decision;
  const digest = ready.digest;
  const warnings = [];

  const toolName = input.toolName != null ? String(input.toolName) : '';
  const toolInput = input.toolInput && typeof input.toolInput === 'object' ? input.toolInput : {};
  const command = extractCommand(toolName, toolInput);
  const paths =
    Array.isArray(input.paths) && input.paths.length
      ? input.paths.map(String)
      : extractTargetPaths(toolName, toolInput);
  const input_summary = toolName
    ? summarizeInput(toolName, toolInput)
    : input.op
      ? `op=${input.op}`
      : input.provider
        ? `provider=${input.provider}`
        : '';

  const risk_class = classifyRisk({
    track: input.track,
    toolName,
    paths,
    riskFlags: input.riskFlags || undefined,
    restrictedOpId: null,
    privileged: false,
  });

  // Provider rules (PD-9 / PD-15): paid providers denied without grant; local $0 allowed.
  if (input.provider) {
    const provider = String(input.provider);
    const local =
      LOCAL_PROVIDERS.has(provider) ||
      input.cost_source === 'local' ||
      (input.flags && input.flags.local_provider === true);
    const grants = toSet(input.authorized);
    if (!local && !grants.has('model.paid') && !grants.has(`provider.${provider}`)) {
      return finish({
        decision: 'deny',
        rule_id: 'provider.paid_denied',
        policy_digest: digest,
        risk_class: 'high',
        reason: `paid provider ${provider} denied without grant (PD-9/PD-15); local providers are exempt`,
        input_summary,
        warnings,
        code: 'PROVIDER_DENIED',
      });
    }
    // Non-loopback base URL for "local" adapters is a policy deny (AE-019b).
    if (local && input.flags && input.flags.non_loopback_base_url) {
      return finish({
        decision: 'deny',
        rule_id: 'provider.non_loopback',
        policy_digest: digest,
        risk_class: 'critical',
        reason: 'local provider configured with non-loopback base URL',
        input_summary,
        warnings,
        code: 'PROVIDER_DENIED',
      });
    }
  }

  // Budget rules over usage events.
  const allowance =
    typeof input.paid_spend_allowance_usd === 'number' ? input.paid_spend_allowance_usd : 0;
  const usage = summarizeUsage(input.usage_events || []);
  if (usage.paid_usd > allowance) {
    return finish({
      decision: 'deny',
      rule_id: 'budget.paid_spend',
      policy_digest: digest,
      risk_class: 'high',
      reason: `paid usage $${usage.paid_usd} exceeds allowance $${allowance}`,
      input_summary,
      warnings,
      code: 'BUDGET_STOP',
    });
  }
  // Zero paid allowance must NOT block local $0 calls.
  if (
    allowance === 0 &&
    usage.paid_usd === 0 &&
    input.provider &&
    (LOCAL_PROVIDERS.has(String(input.provider)) || input.cost_source === 'local')
  ) {
    // fall through — local is fine
  }
  if (input.max_tool_calls != null && usage.tool_calls > Number(input.max_tool_calls)) {
    return finish({
      decision: 'deny',
      rule_id: 'budget.tool_calls',
      policy_digest: digest,
      risk_class: 'medium',
      reason: `tool_calls ${usage.tool_calls} exceeds max ${input.max_tool_calls}`,
      input_summary,
      warnings,
      code: 'BUDGET_STOP',
    });
  }
  if (
    input.max_wall_ms != null &&
    typeof input.wall_ms_used === 'number' &&
    input.wall_ms_used > Number(input.max_wall_ms)
  ) {
    return finish({
      decision: 'deny',
      rule_id: 'budget.wall_time',
      policy_digest: digest,
      risk_class: 'medium',
      reason: `wall_ms ${input.wall_ms_used} exceeds max ${input.max_wall_ms}`,
      input_summary,
      warnings,
      code: 'BUDGET_STOP',
    });
  }

  // Legacy tool-call rules first (banned tools/commands / phase allowlist /
  // protected_paths) so baseline rule ids stay stable for existing hook tests.
  if (toolName) {
    const toolVerdict = evaluateToolCall({
      policy: input.policy,
      toolName,
      toolInput,
      state: input.state,
    });
    warnings.push(...(toolVerdict.warnings || []));
    if (toolVerdict.decision === 'deny') {
      return finish({
        decision: 'deny',
        rule_id: toolVerdict.rule || 'runtime.deny',
        policy_digest: digest,
        risk_class: classifyRisk({
          track: input.track,
          toolName,
          paths,
          riskFlags: input.riskFlags || undefined,
        }),
        reason: toolVerdict.reason || 'policy denied',
        input_summary,
        warnings,
      });
    }
  }

  // Self-improvement merge/deploy/publish: deny unless a disk human authorization
  // record exists; with a record, follow the §15 require_approval path. Grants are
  // never taken from caller-supplied `authorized` / flags (M4 audit item 5 / §15).
  const selfImprovGate = evaluateSelfImprovementMergeDeploy({
    mode: input.mode,
    flags: input.flags,
    actor: input.actor,
    workDir: input.workDir,
    toolName,
    toolInput,
    op: input.op,
  });
  if (selfImprovGate) {
    const rc = classifyRisk({
      track: input.track,
      toolName,
      paths,
      riskFlags: input.riskFlags || undefined,
      restrictedOpId: selfImprovGate.rule_id,
      privileged: false,
    });
    return finish({
      decision: selfImprovGate.decision,
      rule_id: selfImprovGate.rule_id,
      policy_digest: digest,
      risk_class: rc,
      reason: selfImprovGate.reason,
      input_summary,
      warnings,
      code: selfImprovGate.code,
    });
  }

  // §15 restricted operations (explicit op/flags; does not steal baseline rule ids).
  const restricted = matchRestrictedOp({
    op: input.op,
    flags: input.flags,
    toolName,
    toolInput,
    command,
    paths,
  });
  if (restricted) {
    const rc = classifyRisk({
      track: input.track,
      toolName,
      paths,
      riskFlags: input.riskFlags || undefined,
      restrictedOpId: restricted.id,
      privileged: false,
    });
    return finish({
      decision: restricted.decision,
      rule_id: restricted.id,
      policy_digest: digest,
      risk_class: rc,
      reason: `§15 ${restricted.title}`,
      input_summary,
      warnings,
      code: restricted.decision === 'deny' ? 'SECTION15_DENY' : 'SECTION15_APPROVAL',
    });
  }

  // Role / privileged actions (when roles provided or workDir authorizations).
  let authorized = toSet(input.authorized);
  if (input.workDir && authorized.size === 0) {
    const auth = readAuthorizations(input.workDir);
    if (auth.error) warnings.push(auth.error);
    authorized = auth.actions;
  }
  if (input.roles || input.actor) {
    const roles = input.roles instanceof Map ? input.roles : loadRoles().roles;
    const actor = input.actor || resolveActor({ roles, hasWorkItem: Boolean(input.workDir) });
    const roleVerdict = evaluateRoleCall({
      roles,
      actor,
      toolName,
      toolInput,
      authorized,
    });
    if (roleVerdict.decision === 'deny') {
      return finish({
        decision: 'deny',
        rule_id: roleVerdict.rule || 'role.deny',
        policy_digest: digest,
        risk_class: classifyRisk({
          track: input.track,
          toolName,
          paths,
          privileged: privilegedActions(toolName, toolInput).length > 0,
          riskFlags: input.riskFlags || undefined,
        }),
        reason: roleVerdict.reason || 'role denied',
        input_summary,
        warnings,
      });
    }
  }

  // Human-gate preservation check (informational on allow path for transitions).
  if (input.transition) {
    const gate = humanGateRequired({
      track: input.track,
      risk_class,
      to: input.transition.to,
      from: input.transition.from,
    });
    if (gate.required && input.flags && input.flags.waive_human_gate) {
      return finish({
        decision: 'deny',
        rule_id: 'human_gate.preserved',
        policy_digest: digest,
        risk_class: 'low',
        reason: gate.reason,
        input_summary,
        warnings,
        code: 'HUMAN_GATE_REQUIRED',
      });
    }
  }

  // AE-039a / PD-62 C2: org-scoped ops require a disk binding. Skip when no
  // org context. Never elevate via caller-supplied authorized / grants.
  const orgCtx = extractOrgScopedContext(input);
  if (orgCtx) {
    const orgVerdict = evaluateOrgAccess({
      tenantId: orgCtx.tenantId,
      resource: orgCtx.resource,
      action: orgCtx.action,
      principal: orgCtx.principal,
      bindingsDir: input.orgRbacDir || input.bindingsDir || null,
      projectRoot: input.projectRoot || null,
      workDir: input.workDir || null,
    });
    if (orgVerdict.decision === 'deny') {
      return finish({
        decision: 'deny',
        rule_id: orgVerdict.rule_id,
        policy_digest: digest,
        risk_class: classifyRisk({
          track: input.track,
          toolName,
          paths,
          riskFlags: input.riskFlags || undefined,
        }),
        reason: orgVerdict.reason,
        input_summary,
        warnings,
        code: orgVerdict.code,
      });
    }
  }

  return finish({
    decision: 'allow',
    rule_id: 'pdp.allow',
    policy_digest: digest,
    risk_class: classifyRisk({
      track: input.track,
      toolName,
      paths,
      riskFlags: input.riskFlags || undefined,
      privileged: privilegedActions(toolName, toolInput).length > 0,
    }),
    reason: 'allowed',
    input_summary,
    warnings,
  });
}

function toSet(value) {
  if (!value) return new Set();
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return new Set();
}

/**
 * Redacted payload suitable for policy.decided journal events.
 * @param {PolicyDecision} decision
 * @param {object} [extra]
 */
function journalPayload(decision, extra = {}) {
  return redactDeep({
    decision: decision.decision,
    rule_id: decision.rule_id,
    policy_digest: decision.policy_digest,
    risk_class: decision.risk_class,
    reason: decision.reason,
    input_summary: decision.input_summary,
    code: decision.code,
    critical_failure: decision.critical_failure || false,
    ...extra,
  });
}

module.exports = {
  LOCAL_PROVIDERS,
  evaluate,
  assertPolicyReady,
  summarizeUsage,
  journalPayload,
  policyDigest,
  humanGateRequired,
  classifyRisk,
};
