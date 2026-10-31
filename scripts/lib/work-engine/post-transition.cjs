'use strict';

const path = require('node:path');

/** Hook modules, relative to the plugin root, run after every committed transition. */
const DEFAULT_POST_TRANSITION_HOOKS = ['scripts/lib/post-transition/muscle-memory.cjs'];

/**
 * Run post-transition hooks after state.json is written. Hooks are best-effort: a failing
 * hook never undoes the transition, and its error is returned for the caller to surface.
 * Each hook module exports `afterTransition(ctx)`.
 * @param {object} opts
 * @param {string} opts.pluginRoot
 * @param {string[]} [opts.hooks] module paths relative to pluginRoot (or absolute)
 * @param {object} opts.ctx { workDir, pluginRoot, from, to, procedureStoreRoot }
 * @returns {{ ran: string[], errors: { hook: string, message: string }[] }}
 */
function runPostTransitionHooks(opts) {
  const hooks = opts.hooks || DEFAULT_POST_TRANSITION_HOOKS;
  const ran = [];
  const errors = [];
  for (const hook of hooks) {
    const modulePath = path.isAbsolute(hook) ? hook : path.join(opts.pluginRoot, hook);
    try {
      const mod = require(modulePath);
      if (typeof mod.afterTransition !== 'function') {
        throw new Error('hook module does not export afterTransition');
      }
      mod.afterTransition(opts.ctx);
      ran.push(hook);
    } catch (e) {
      errors.push({ hook, message: String((e && e.message) || e) });
    }
  }
  return { ran, errors };
}

module.exports = { DEFAULT_POST_TRANSITION_HOOKS, runPostTransitionHooks };
