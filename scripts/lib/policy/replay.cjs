'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readJournal } = require('../shared/journal.cjs');
const { evaluate } = require('./pdp.cjs');
const { resolvePolicyChecked } = require('./merge.cjs');

/**
 * Re-evaluate every policy.decided event against a policy.
 *
 * @param {{
 *   workDir: string,
 *   policy?: object,
 *   packRoot?: string,
 *   projectRoot?: string,
 * }} opts
 * @returns {{ ok: boolean, checked: number, mismatches: Array<object> }}
 */
function replayPolicyDecisions(opts) {
  const workDir = opts.workDir;
  if (!workDir || !fs.existsSync(workDir)) {
    return { ok: false, checked: 0, mismatches: [{ error: 'workDir missing' }] };
  }

  let policy = opts.policy;
  if (!policy) {
    const packRoot = opts.packRoot || path.join(__dirname, '..', '..', '..');
    const projectRoot = opts.projectRoot || path.resolve(workDir, '..', '..');
    const resolved = resolvePolicyChecked(projectRoot, packRoot);
    if (resolved.errors && resolved.errors.length) {
      return { ok: false, checked: 0, mismatches: [{ error: resolved.errors.join('; ') }] };
    }
    policy = resolved.policy;
  }

  const journal = readJournal(workDir);
  if (!journal.ok) {
    return { ok: false, checked: 0, mismatches: [{ error: journal.error || 'journal unreadable' }] };
  }

  const mismatches = [];
  let checked = 0;
  for (const ev of journal.events) {
    if (!ev || ev.type !== 'policy.decided') continue;
    checked += 1;
    const payload = ev.payload || {};
    const replayed = evaluate({
      policy,
      toolName: payload.tool_name || '',
      toolInput: payload.tool_input || {},
      state: payload.state || null,
      track: payload.track || null,
      op: payload.op || null,
      flags: payload.flags || undefined,
      provider: payload.provider || null,
      cost_source: payload.cost_source || null,
      pinned_digest: null,
    });
    if (
      replayed.decision !== payload.decision ||
      replayed.rule_id !== payload.rule_id ||
      (payload.policy_digest && replayed.policy_digest !== payload.policy_digest)
    ) {
      mismatches.push({
        seq: ev.seq,
        recorded: {
          decision: payload.decision,
          rule_id: payload.rule_id,
          policy_digest: payload.policy_digest,
        },
        replayed: {
          decision: replayed.decision,
          rule_id: replayed.rule_id,
          policy_digest: replayed.policy_digest,
        },
      });
    }
  }

  return { ok: mismatches.length === 0, checked, mismatches };
}

module.exports = { replayPolicyDecisions };
