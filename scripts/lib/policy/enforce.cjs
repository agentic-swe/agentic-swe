'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolvePolicyChecked, checkTrackRules, matchesPolicyPattern } = require('./merge.cjs');
const { normalizeTarget } = require('./runtime.cjs');

const TRACK_RANK = { lean: 0, standard: 1, rigorous: 2 };

/** Project root of `<repo>/.worklogs/<id>`, or null for a work dir outside `.worklogs/`. */
function projectRootOf(workDir) {
  const logs = path.dirname(path.resolve(workDir));
  return path.basename(logs) === '.worklogs' ? path.dirname(logs) : null;
}

/**
 * Merged pack + repo + org policy for a work item. Errors name each unreadable or invalid source.
 * @returns {{ policy: object, errors: string[], projectRoot: string|null }}
 */
function loadTransitionPolicy(workDir, pluginRoot) {
  const projectRoot = projectRootOf(workDir);
  const { policy, errors } = resolvePolicyChecked(projectRoot, pluginRoot);
  return { policy, errors, projectRoot };
}

function needsPaths(policy) {
  return (policy.track_rules || []).length > 0 || (policy.mandatory_subagents || []).length > 0;
}

function git(projectRoot, args) {
  const r = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

/** HEAD sha when projectRoot is a git work tree, else null. */
function gitHead(projectRoot) {
  if (!projectRoot) return null;
  const out = git(projectRoot, ['rev-parse', 'HEAD']);
  return out ? out.trim() : null;
}

/**
 * Repo-relative policy path, or null for a path outside the project.
 * @param {string} p
 * @param {string|null} projectRoot
 */
function toPolicyPath(p, projectRoot) {
  let s = String(p || '').trim();
  if (!s) return null;
  if (path.isAbsolute(s) && projectRoot) {
    s = path.relative(projectRoot, s);
    if (s.startsWith('..')) return null;
  }
  const n = normalizeTarget(s);
  return n && n !== '.' ? n : null;
}

/**
 * Paths a work item touches: `pipeline.changed_paths` (declared with --changed-paths), plus,
 * when `pipeline.base_sha` is recorded, files that differ from it in the work tree.
 * @param {object} state
 * @param {string|null} projectRoot
 * @param {string[]} [extra] paths declared by the transition being validated
 * @returns {{ ok: true, paths: string[] } | { ok: false, code: string, message: string }}
 */
function collectChangedPaths(state, projectRoot, extra = []) {
  const out = new Set();
  const add = (p) => {
    const n = toPolicyPath(p, projectRoot);
    if (n && !n.startsWith('.worklogs/')) out.add(n);
  };
  for (const p of (state.pipeline && state.pipeline.changed_paths) || []) add(p);
  for (const p of extra) add(p);

  const base = state.pipeline && state.pipeline.base_sha;
  if (base) {
    const diff = projectRoot ? git(projectRoot, ['diff', '--name-only', '--relative', base]) : null;
    const untracked = projectRoot ? git(projectRoot, ['ls-files', '--others', '--exclude-standard']) : null;
    if (diff == null || untracked == null) {
      return {
        ok: false,
        code: 'POLICY_PATHS_UNAVAILABLE',
        message: `cannot list files changed since pipeline.base_sha ${base}; policy path rules cannot be evaluated`,
      };
    }
    for (const line of `${diff}\n${untracked}`.split('\n')) add(line);
  }
  return { ok: true, paths: [...out].sort() };
}

function roleKey(role) {
  return path.basename(String(role || '')).replace(/\.md$/i, '').toLowerCase();
}

function trackRuleCheck({ policy, state, from, setPipelineTrack, paths }) {
  const rules = policy.track_rules || [];
  if (rules.length === 0) return { ok: true };
  if (from !== 'lean-track-check' && !setPipelineTrack) return { ok: true };
  const track = setPipelineTrack || (state.pipeline && state.pipeline.track);
  if (!Object.prototype.hasOwnProperty.call(TRACK_RANK, track) || track === 'rigorous') return { ok: true };

  const list = paths();
  if (!list.ok) return list;
  if (list.paths.length === 0) {
    return {
      ok: false,
      code: 'POLICY_PATHS_REQUIRED',
      message:
        `policy track_rules apply but no changed paths are declared; pass --changed-paths a,b ` +
        `(or choose --set-pipeline-track rigorous) before taking the ${track} track`,
    };
  }
  const minimum = checkTrackRules(list.paths, policy);
  if (minimum && TRACK_RANK[track] < TRACK_RANK[minimum]) {
    const hits = rules
      .filter((r) => r.minimum_track === minimum && list.paths.some((p) => matchesPolicyPattern(p, r.pattern)))
      .map((r) => (r.reason ? `${r.pattern} (${r.reason})` : r.pattern));
    return {
      ok: false,
      code: 'TRACK_POLICY',
      message: `policy track_rules require at least ${minimum} for ${hits.join(', ')}; ${track} was requested`,
      minimum_track: minimum,
    };
  }
  return { ok: true };
}

function mandatorySubagentCheck({ policy, state, from, to, paths }) {
  const rules = policy.mandatory_subagents || [];
  if (rules.length === 0) return { ok: true };
  const beforePr = from === 'validation' && to === 'pr-creation';
  const relevant = beforePr ? rules : rules.filter((r) => r.phase === from);
  if (relevant.length === 0) return { ok: true };

  const list = paths();
  if (!list.ok) return list;
  const spawns = (state.history || []).filter((e) => e && typeof e === 'object' && e.kind === 'spawn');
  const missing = [];
  for (const rule of relevant) {
    if (!list.paths.some((p) => matchesPolicyPattern(p, rule.pattern))) continue;
    const inPhase = !beforePr && rule.phase === from;
    const recorded = spawns.some(
      (e) => roleKey(e.role) === roleKey(rule.subagent) && (!inPhase || e.from === from)
    );
    if (!recorded) missing.push(`${rule.subagent} for ${rule.pattern}${rule.phase ? ` in ${rule.phase}` : ''}`);
  }
  if (missing.length) {
    return {
      ok: false,
      code: 'MANDATORY_SUBAGENT_MISSING',
      message: `policy mandatory_subagents not recorded (work record-spawn --role <subagent>): ${missing.join('; ')}`,
      missing,
    };
  }
  return { ok: true };
}

/**
 * Policy checks for one transition: track_rules (leaving lean-track-check, or any
 * --set-pipeline-track) and mandatory_subagents (leaving the rule's phase, and again
 * before pr-creation for every rule).
 * @param {object} p
 * @param {object} p.policy merged policy
 * @param {string|null} p.projectRoot
 * @param {object} p.state
 * @param {string} p.from
 * @param {string} p.to
 * @param {string} [p.setPipelineTrack]
 * @param {string[]} [p.changedPaths]
 */
function assertPolicyForTransition(p) {
  let cached = null;
  const paths = () => {
    if (!cached) cached = collectChangedPaths(p.state, p.projectRoot, p.changedPaths || []);
    return cached;
  };
  const track = trackRuleCheck({ ...p, paths });
  if (!track.ok) return track;
  return mandatorySubagentCheck({ ...p, paths });
}

module.exports = {
  TRACK_RANK,
  projectRootOf,
  loadTransitionPolicy,
  needsPaths,
  gitHead,
  collectChangedPaths,
  assertPolicyForTransition,
};
