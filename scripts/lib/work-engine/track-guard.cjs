'use strict';

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

module.exports = {
  TRACK_RANK,
  assertSetPipelineTrack,
};
