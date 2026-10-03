'use strict';

/**
 * Rigorous-track permissions gate: entering validation must come from
 * permissions-check, or carry an explicit pipeline.permissions_waiver.
 *
 * @param {{ track?: string|null, from: string, to: string, state: object }} opts
 * @returns {{ ok: boolean, code?: string, message?: string }}
 */
function assertPermissionsGate(opts) {
  const { from, to, state } = opts;
  const track = state && state.pipeline && state.pipeline.track;
  const effective = track === 'lean' || track === 'standard' || track === 'rigorous' ? track : 'rigorous';

  if (to !== 'validation') return { ok: true };
  if (effective !== 'rigorous') return { ok: true };

  const waiver = state.pipeline && state.pipeline.permissions_waiver;
  const waiverOk =
    waiver &&
    typeof waiver === 'object' &&
    typeof waiver.actor === 'string' &&
    waiver.actor.trim() &&
    typeof waiver.reason === 'string' &&
    waiver.reason.trim() &&
    typeof waiver.at === 'string' &&
    waiver.at.trim();

  if (from === 'permissions-check') return { ok: true };
  if (waiverOk) return { ok: true };

  return {
    ok: false,
    code: 'PERMISSIONS_GATE',
    message:
      'rigorous track requires permissions-check → validation, or pipeline.permissions_waiver { actor, reason, at }',
  };
}

/**
 * Leaving permissions-check: require permissions-changes.md OR a recorded waiver.
 * @param {{ workDir: string, from: string, to: string, state: object, fileNonEmpty: Function }} opts
 */
function assertPermissionsArtifactOrWaiver(opts) {
  const { workDir, from, to, state, fileNonEmpty } = opts;
  if (from !== 'permissions-check') return { ok: true };

  const pathMod = require('node:path');
  const hasArtifact = fileNonEmpty(pathMod.join(workDir, 'permissions-changes.md'));
  const waiver = state.pipeline && state.pipeline.permissions_waiver;
  const waiverOk =
    waiver &&
    typeof waiver === 'object' &&
    typeof waiver.actor === 'string' &&
    waiver.actor.trim() &&
    typeof waiver.reason === 'string' &&
    waiver.reason.trim() &&
    typeof waiver.at === 'string' &&
    waiver.at.trim();

  if (hasArtifact || waiverOk) return { ok: true };

  return {
    ok: false,
    code: 'PERMISSIONS_ARTIFACT_OR_WAIVER',
    message: `leaving permissions-check toward ${to} requires permissions-changes.md or pipeline.permissions_waiver`,
  };
}

module.exports = {
  assertPermissionsGate,
  assertPermissionsArtifactOrWaiver,
};
