'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TRACK_RANK = { lean: 0, standard: 1, rigorous: 2 };

function waiverOk(waiver) {
  return Boolean(
    waiver &&
    typeof waiver === 'object' &&
    typeof waiver.actor === 'string' &&
    waiver.actor.startsWith('user:') &&
    typeof waiver.reason === 'string' &&
    waiver.reason.trim() &&
    typeof waiver.at === 'string' &&
    waiver.at.trim()
  );
}

/**
 * `--set-pipeline-track` is accepted when leaving lean-track-check.
 * Later, only a strictly lower track is accepted, and only with a human waiver.
 * @returns {{ ok: true } | { ok: false, code: string, message: string }}
 */
function assertSetPipelineTrack({ from, state, setPipelineTrack }) {
  if (!setPipelineTrack) return { ok: true };
  if (!Object.prototype.hasOwnProperty.call(TRACK_RANK, setPipelineTrack)) {
    return {
      ok: false,
      code: 'TRACK_GUARD',
      message: `--set-pipeline-track must be one of: ${Object.keys(TRACK_RANK).join(', ')}`,
    };
  }
  if (from === 'lean-track-check') return { ok: true };

  const current = state && state.pipeline && state.pipeline.track;
  const waiver = state && state.pipeline && state.pipeline.track_waiver;
  const downgrade =
    Object.prototype.hasOwnProperty.call(TRACK_RANK, current) &&
    TRACK_RANK[setPipelineTrack] < TRACK_RANK[current];
  if (downgrade && waiverOk(waiver)) return { ok: true };

  return {
    ok: false,
    code: 'TRACK_GUARD',
    message:
      'set-pipeline-track is only accepted when leaving lean-track-check. ' +
      'A lower track after that requires pipeline.track_waiver { actor: "user:…", reason, at } written by `work waive-track`.',
  };
}

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
  const { loadWorkItem } = require('./engine.cjs');
  const loaded = loadWorkItem(workDir, pluginRoot);
  if (!loaded.ok) return loaded;

  const at = new Date().toISOString();
  const next = structuredClone(loaded.state);
  next.pipeline = next.pipeline || {};
  next.pipeline.track_waiver = { actor: identity.actor, reason: String(reason).trim(), at };
  next.updated_at = at;

  const { withWriteLockSync } = require('./state-lock.cjs');
  const { commitState } = require('./journal.cjs');
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

module.exports = {
  TRACK_RANK,
  assertSetPipelineTrack,
  recordTrackWaiver,
};
