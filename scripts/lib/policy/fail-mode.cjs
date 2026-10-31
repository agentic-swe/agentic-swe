'use strict';

const fs = require('node:fs');
const path = require('node:path');

const RUNTIME_FILE = path.join('.agentic-swe', 'runtime.json');

/**
 * Decide whether a policy-hook error (bad input, unreadable or invalid policy, crash)
 * denies the tool call.
 *
 * Closed when the active work item is rigorous, has no track, or has unreadable state;
 * in lean/standard (or with no work item) only when `.agentic-swe/runtime.json` sets
 * `policy.fail_closed: true` or `AGENTIC_SWE_POLICY_FAIL_CLOSED=1`. Neither setting can
 * open a mode that is already closed.
 *
 * @param {{ hasWorkItem: boolean, state: object|null, projectRoot: string, env?: object }} p
 * @returns {{ closed: boolean, why: string }}
 */
function hookErrorMode({ hasWorkItem, state, projectRoot, env = process.env }) {
  if (hasWorkItem) {
    const track = state && state.pipeline ? state.pipeline.track : undefined;
    if (!state) return { closed: true, why: 'work item state is unreadable' };
    if (track !== 'lean' && track !== 'standard') return { closed: true, why: `track is ${track || 'missing'}` };
  }
  if (env.AGENTIC_SWE_POLICY_FAIL_CLOSED === '1') return { closed: true, why: 'AGENTIC_SWE_POLICY_FAIL_CLOSED=1' };
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
  }
  return { closed: false, why: hasWorkItem ? `track is ${state.pipeline.track}` : 'no active work item' };
}

module.exports = { hookErrorMode, RUNTIME_FILE };
