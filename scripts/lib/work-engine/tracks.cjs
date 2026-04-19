'use strict';

/**
 * Track-specific transition filters (CLAUDE.md "Track-specific transitions").
 * Missing pipeline.track is treated as rigorous (per CLAUDE.md).
 * @param {string|null|undefined} track
 * @returns {'lean'|'standard'|'rigorous'}
 */
function normalizeTrack(track) {
  if (track === 'lean' || track === 'standard' || track === 'rigorous') return track;
  return 'rigorous';
}

/**
 * @param {string} from
 * @param {string} to
 * @param {string|null|undefined} track
 * @returns {{ allowed: boolean, reason?: string }}
 */
function isTransitionAllowedForTrack(from, to, track) {
  const t = normalizeTrack(track);

  if (from === 'lean-track-check') {
    if (t === 'lean' && to === 'design') {
      return { allowed: false, reason: 'lean track requires lean-track-check → lean-track-implementation' };
    }
    if (t !== 'lean' && to === 'lean-track-implementation') {
      return {
        allowed: false,
        reason: 'standard/rigorous track forbids lean-track-check → lean-track-implementation',
      };
    }
  }

  if (from === 'design') {
    if (t === 'standard' && to === 'design-review') {
      return { allowed: false, reason: 'standard track forbids design → design-review (go to verification)' };
    }
    if (t === 'rigorous' && to === 'verification') {
      return { allowed: false, reason: 'rigorous track forbids design → verification (go to design-review)' };
    }
  }

  if (from === 'self-review') {
    if (t === 'standard' && to === 'code-review') {
      return { allowed: false, reason: 'standard track forbids self-review → code-review (go to validation)' };
    }
    if (t === 'rigorous' && to === 'validation') {
      return { allowed: false, reason: 'rigorous track forbids self-review → validation (go to code-review)' };
    }
  }

  return { allowed: true };
}

module.exports = { normalizeTrack, isTransitionAllowedForTrack };
