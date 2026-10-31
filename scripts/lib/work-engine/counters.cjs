'use strict';

/** Caps used when no merged budget config is available. */
const DEFAULT_CAPS = {
  lean_iter: 2,
  design_iter: 3,
  code_iter: 5,
  merge_iter: 2,
  approval_iter: 3,
  self_review_iter: 1,
  test_adequacy_iter: 1,
};

/** Counters `work validate` recomputes from history. */
const OWNED_COUNTERS = [
  'lean_iter',
  'design_iter',
  'code_iter',
  'self_review_iter',
  'approval_iter',
  'panel_runs',
  'subagent_spawns',
];

/**
 * Counter consumed by a rejection edge, or null.
 * `approval-wait → implementation` is reported so history can be replayed, but
 * `decideTransition` does not write it: `work approve` does.
 * On the lean track, `validation → implementation` is the review rejection and
 * consumes `lean_iter`. On every other track that same edge consumes `code_iter`.
 * @param {string} from
 * @param {string} to
 * @param {string} [track]
 * @returns {string|null}
 */
function rejectionCounter(from, to, track) {
  if (from === 'self-review' && to === 'implementation') return 'self_review_iter';
  if (from === 'code-review' && to === 'implementation') return 'code_iter';
  if (from === 'validation' && to === 'implementation') {
    return track === 'lean' ? 'lean_iter' : 'code_iter';
  }
  if (from === 'design-review' && to === 'design') return 'design_iter';
  if (from === 'verification' && to === 'design') return 'design_iter';
  if (from === 'approval-wait' && to === 'implementation') return 'approval_iter';
  return null;
}

function spawnCounterName(role) {
  const name = String(role || '');
  if (name === 'panel' || name.startsWith('panel:')) return 'panel_runs';
  return 'subagent_spawns';
}

function bump(state, name) {
  state.counters = state.counters || {};
  const current = state.counters[name];
  state.counters[name] = (typeof current === 'number' ? current : 0) + 1;
}

/**
 * @param {object} state parsed state.json (read only)
 * @param {string} from
 * @param {string} to
 * @param {object|null} caps getCounterCaps() result; null uses DEFAULT_CAPS
 * @returns {{ ok: false, code: 'BUDGET_STOP', message: string }|null}
 */
function rejectionCapBlock(state, from, to, caps) {
  const track = state.pipeline && state.pipeline.track;
  const name = rejectionCounter(from, to, track);
  if (!name || name === 'approval_iter') return null;
  const max = name === 'design_iter'
    ? Number(caps && caps._design_max_effective != null ? caps._design_max_effective : DEFAULT_CAPS.design_iter)
    : Number(caps && caps[name] != null ? caps[name] : DEFAULT_CAPS[name]);
  const current = typeof state.counters?.[name] === 'number' ? state.counters[name] : 0;
  if (Number.isFinite(max) && current >= max) {
    return {
      ok: false,
      code: 'BUDGET_STOP',
      message: `counters.${name}=${current} exceeds max ${max}`,
    };
  }
  return null;
}

/**
 * Replay owned counters from history. A rejection entry may carry `counter`;
 * otherwise the edge is mapped with `entry.track` (absent means not lean).
 * @param {object[]} history
 */
function recomputeCounters(history) {
  const counters = {};
  for (const key of OWNED_COUNTERS) counters[key] = 0;
  for (const entry of history || []) {
    if (!entry) continue;
    if (entry.kind === 'spawn') {
      const name = entry.counter === 'panel_runs' ? 'panel_runs' : 'subagent_spawns';
      counters[name] += 1;
      continue;
    }
    const name = entry.counter || rejectionCounter(entry.from, entry.to, entry.track);
    if (name && Object.prototype.hasOwnProperty.call(counters, name)) counters[name] += 1;
  }
  return counters;
}

/**
 * @param {object} state
 * @returns {{ key: string, stored: number, expected: number }[]}
 */
function counterMismatches(state) {
  const expected = recomputeCounters(state.history);
  const mismatches = [];
  for (const key of OWNED_COUNTERS) {
    const stored = typeof state.counters?.[key] === 'number' ? state.counters[key] : 0;
    if (stored !== expected[key]) mismatches.push({ key, stored, expected: expected[key] });
  }
  return mismatches;
}

/**
 * Pure spawn record. Keeps the history chain contiguous by using the current
 * state as both ends; `kind: 'spawn'` keeps it out of the rejection tally.
 * @param {object} state
 * @param {{ role: string, actor?: string, now: string }} input
 */
function decideSpawn(state, input) {
  const next = structuredClone(state);
  const counter = spawnCounterName(input.role);
  bump(next, counter);
  next.updated_at = input.now;
  const entry = {
    at: input.now,
    actor: input.actor || 'unknown',
    from: state.current_state,
    to: state.current_state,
    kind: 'spawn',
    role: input.role,
    counter,
  };
  if (!Array.isArray(next.history)) next.history = [];
  next.history.push(entry);
  return { next, entry };
}

module.exports = {
  DEFAULT_CAPS,
  OWNED_COUNTERS,
  rejectionCounter,
  spawnCounterName,
  bump,
  rejectionCapBlock,
  recomputeCounters,
  counterMismatches,
  decideSpawn,
};
