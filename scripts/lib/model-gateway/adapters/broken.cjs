'use strict';

/**
 * Deliberately broken adapter — fails the conformance suite on purpose.
 * Used by tests to prove the suite rejects non-conforming adapters.
 */

const brokenAdapter = {
  id: 'broken',

  // Wrong shape: missing required capability fields / returns a string
  discoverCapabilities(_model) {
    return { tools: 'yes', context: 100 };
  },

  async complete(req) {
    // Does not respect AbortSignal
    // Throws with raw secret and wrong retryable flags for 401
    const fakeKey = 'sk-plantedFAKESECRET99999999999999999999';
    const err = new Error(`auth failed with api_key=${fakeKey}`);
    err.status = 401;
    err.retryable = true; // WRONG — 401 must never be retryable
    err.code = 'AUTH_ERROR';
    throw err;
  },
};

module.exports = brokenAdapter;
