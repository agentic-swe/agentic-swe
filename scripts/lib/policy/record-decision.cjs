'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { appendEvent } = require('../shared/journal.cjs');
const { formatAuditLine } = require('./runtime.cjs');
const { journalPayload } = require('./pdp.cjs');

/**
 * Journal a policy.decided side event and keep the legacy audit.log line.
 *
 * @param {{
 *   workDir?: string|null,
 *   decision: object,
 *   toolName?: string,
 *   state?: string|null,
 *   track?: string|null,
 *   op?: string|null,
 *   provider?: string|null,
 *   cost_source?: string|null,
 *   flags?: object,
 *   toolInput?: object,
 *   idempotency_key?: string,
 * }} opts
 */
function recordPolicyDecision(opts) {
  const decision = opts.decision;
  if (!decision) return null;
  const workDir = opts.workDir || null;
  const payload = journalPayload(decision, {
    tool_name: opts.toolName || undefined,
    state: opts.state != null ? opts.state : undefined,
    track: opts.track != null ? opts.track : undefined,
    op: opts.op || undefined,
    provider: opts.provider || undefined,
    cost_source: opts.cost_source || undefined,
    flags: opts.flags || undefined,
    tool_input: opts.toolInput && typeof opts.toolInput === 'object' ? { keys: Object.keys(opts.toolInput) } : undefined,
  });

  let event = null;
  if (workDir) {
    try {
      event = appendEvent(workDir, {
        type: 'policy.decided',
        payload,
        idempotency_key: opts.idempotency_key,
      });
    } catch {
      /* journal best-effort for in-host hook; hosted mode treats failures as critical elsewhere */
      event = null;
    }
    if (opts.write_audit !== false) {
      try {
        fs.appendFileSync(
          path.join(workDir, 'audit.log'),
          `${formatAuditLine({
            toolName: opts.toolName || opts.op || 'policy',
            decision: decision.decision === 'require_approval' ? 'require_approval' : decision.decision,
            state: opts.state,
            rule: decision.rule_id,
            input: decision.input_summary || '',
          })}\n`,
          'utf8'
        );
      } catch {
        /* audit best-effort */
      }
    }
  }
  return event;
}

module.exports = { recordPolicyDecision };
