'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RUNTIME_FILE = path.join('.agentic-swe', 'runtime.json');

/**
 * Decide whether a policy-hook error (bad input, unreadable or invalid policy, crash)
 * denies the tool call.
 *
 * Default is fail-closed on every track (and with no work item). Cooperative fail-open
 * is opt-in only via an explicit human runtime flag:
 *   - `AGENTIC_SWE_POLICY_FAIL_OPEN=1`, or
 *   - `.agentic-swe/runtime.json` → `{ "policy": { "fail_open": true } }`
 * `AGENTIC_SWE_POLICY_FAIL_CLOSED=1` / `policy.fail_closed: true` remain closed (tighten-only).
 *
 * @param {{ hasWorkItem: boolean, state: object|null, projectRoot: string, env?: object }} p
 * @returns {{ closed: boolean, why: string }}
 */
function hookErrorMode({ hasWorkItem, state, projectRoot, env = process.env }) {
  if (hasWorkItem && !state) {
    return { closed: true, why: 'work item state is unreadable' };
  }

  // Explicit cooperative fail-open (human-only). Never inferred from track.
  if (env.AGENTIC_SWE_POLICY_FAIL_OPEN === '1') {
    return { closed: false, why: 'AGENTIC_SWE_POLICY_FAIL_OPEN=1 (cooperative)' };
  }

  const file = path.join(projectRoot, RUNTIME_FILE);
  if (fs.existsSync(file)) {
    let runtime;
    try {
      runtime = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return { closed: true, why: `${RUNTIME_FILE} is unreadable` };
    }
    if (runtime && runtime.policy && runtime.policy.fail_closed === true) {
      return { closed: true, why: `${RUNTIME_FILE} policy.fail_closed` };
    }
    if (runtime && runtime.policy && runtime.policy.fail_open === true) {
      return { closed: false, why: `${RUNTIME_FILE} policy.fail_open (cooperative)` };
    }
  }

  if (env.AGENTIC_SWE_POLICY_FAIL_CLOSED === '1') {
    return { closed: true, why: 'AGENTIC_SWE_POLICY_FAIL_CLOSED=1' };
  }

  const track = state && state.pipeline ? state.pipeline.track : undefined;
  return {
    closed: true,
    why: hasWorkItem
      ? `default fail-closed (track ${track || 'missing'})`
      : 'default fail-closed (no active work item)',
  };
}

module.exports = { hookErrorMode, RUNTIME_FILE };
