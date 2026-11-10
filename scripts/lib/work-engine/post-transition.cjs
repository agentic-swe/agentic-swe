'use strict';

const path = require('node:path');
const { evaluate } = require('../policy/pdp.cjs');

/** Hook modules, relative to the plugin root, run after every committed transition. */
const DEFAULT_POST_TRANSITION_HOOKS = ['scripts/lib/post-transition/muscle-memory.cjs'];

/**
 * ADR-016: only engine-owned relative hook paths under scripts/lib/post-transition/
 * (or the default manifest) may load. Absolute paths are test-only via allowAbsolute.
 * @param {string} hook
 * @param {string} pluginRoot
 * @param {{ allowAbsolute?: boolean }} [opts]
 */
function resolveHookPath(hook, pluginRoot, opts = {}) {
  if (typeof hook !== 'string' || !hook.trim()) {
    const err = new Error('post-transition hook path is required');
    err.code = 'HOOK_PATH_DENIED';
    throw err;
  }
  if (path.isAbsolute(hook)) {
    if (!opts.allowAbsolute) {
      const err = new Error('absolute post-transition hook paths are not permitted outside tests');
      err.code = 'HOOK_PATH_DENIED';
      throw err;
    }
    return hook;
  }
  const normalized = hook.replace(/\\/g, '/');
  if (normalized.includes('..') || path.isAbsolute(normalized)) {
    const err = new Error('post-transition hook path escapes the plugin root');
    err.code = 'HOOK_PATH_DENIED';
    throw err;
  }
  if (
    normalized !== DEFAULT_POST_TRANSITION_HOOKS[0] &&
    !normalized.startsWith('scripts/lib/post-transition/')
  ) {
    const err = new Error(`post-transition hook ${normalized} is outside the engine-owned manifest`);
    err.code = 'HOOK_PATH_DENIED';
    throw err;
  }
  return path.join(pluginRoot, normalized);
}

/**
 * Run post-transition hooks after state.json is written. Hooks are post-commit
 * subscribers (ADR-016): they never gate the transition. Absolute module paths
 * are refused unless opts.allowAbsolute is set (tests only). When a policy is
 * supplied, each hook is checked with the PDP before require/execute.
 * @param {object} opts
 * @param {string} opts.pluginRoot
 * @param {string[]} [opts.hooks] module paths relative to pluginRoot
 * @param {object} opts.ctx { workDir, pluginRoot, from, to, procedureStoreRoot }
 * @param {object} [opts.policy]
 * @param {Function} [opts.policyEvaluator]
 * @param {boolean} [opts.allowAbsolute]
 * @returns {{ ran: string[], errors: { hook: string, message: string }[], denied: string[] }}
 */
function runPostTransitionHooks(opts) {
  const hooks = opts.hooks || DEFAULT_POST_TRANSITION_HOOKS;
  const ran = [];
  const errors = [];
  const denied = [];
  const evaluatePolicy = typeof opts.policyEvaluator === 'function' ? opts.policyEvaluator : evaluate;
  for (const hook of hooks) {
    try {
      if (opts.policy) {
        const decision = evaluatePolicy({
          policy: opts.policy,
          toolName: 'post_transition.hook',
          toolInput: { hook },
          track: opts.ctx && opts.ctx.track,
          state: opts.ctx && opts.ctx.to,
          workDir: opts.ctx && opts.ctx.workDir,
        });
        if (!decision || decision.decision !== 'allow') {
          denied.push(hook);
          const entry = {
            hook,
            message: (decision && decision.reason) || 'post-transition hook denied by policy',
          };
          if (decision && decision.code) entry.code = decision.code;
          else entry.code = 'POLICY_DENIED';
          errors.push(entry);
          continue;
        }
      }
      const modulePath = resolveHookPath(hook, opts.pluginRoot, { allowAbsolute: opts.allowAbsolute });
      // Dynamic require: allow-listed in config/layers.json (ADR-016).
      const mod = require(modulePath);
      if (typeof mod.afterTransition !== 'function') {
        throw new Error('hook module does not export afterTransition');
      }
      mod.afterTransition(opts.ctx);
      ran.push(hook);
    } catch (e) {
      const entry = { hook, message: String((e && e.message) || e) };
      if (e && e.code) entry.code = e.code;
      errors.push(entry);
    }
  }
  return { ran, errors, denied };
}

module.exports = { DEFAULT_POST_TRANSITION_HOOKS, runPostTransitionHooks, resolveHookPath };
