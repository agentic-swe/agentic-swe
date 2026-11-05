'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadWorkItem } = require('./engine.cjs');
const { withWriteLockSync } = require('../shared/state-lock.cjs');
const { commitState } = require('../shared/journal.cjs');

/**
 * Record a one-line human waiver. Does not change pipeline.track.
 * Callers verify a human context first.
 */
function recordTrackWaiver({ workDir, pluginRoot, reason, identity }) {
  if (!reason || !String(reason).trim()) {
    return { ok: false, code: 'MISSING_REASON', message: 'waive-track requires --reason' };
  }
  if (!identity || typeof identity.actor !== 'string' || !identity.actor.startsWith('user:')) {
    return { ok: false, code: 'NO_IDENTITY', message: 'cannot resolve a user: identity (git user.email or OS user)' };
  }
  const loaded = loadWorkItem(workDir, pluginRoot);
  if (!loaded.ok) return loaded;

  const at = new Date().toISOString();
  const next = structuredClone(loaded.state);
  next.pipeline = next.pipeline || {};
  next.pipeline.track_waiver = { actor: identity.actor, reason: String(reason).trim(), at };
  next.updated_at = at;

  try {
    withWriteLockSync(workDir, () => {
      const snapshot = commitState(workDir, next, {
        type: 'track-waiver',
        at,
        expectCurrent: loaded.state.current_state,
      });
      fs.writeFileSync(loaded.statePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    });
  } catch (e) {
    if (e && (e.code === 'LOCK_TIMEOUT' || e.code === 'INTEGRITY_FAILED')) {
      return { ok: false, code: e.code, message: String(e.message) };
    }
    return { ok: false, code: 'WRITE_ERROR', message: String(e.message) };
  }

  const line = `${at} actor=${identity.actor} action=track-waiver reason=${JSON.stringify(String(reason).trim())}`;
  fs.appendFileSync(path.join(workDir, 'audit.log'), `${line}\n`, 'utf8');
  return { ok: true, track_waiver: next.pipeline.track_waiver };
}

module.exports = { recordTrackWaiver };
