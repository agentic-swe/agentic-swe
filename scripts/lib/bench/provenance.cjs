'use strict';

/**
 * Provenance labels for bench JSON outputs. A number is `measured` only when every input
 * was observed (test exit codes, provider-reported usage). Anything that depends on a
 * configured constant or a token estimate is `estimated`.
 */
const PROVENANCE = Object.freeze({ MEASURED: 'measured', ESTIMATED: 'estimated' });

const POLICY_TOKEN_FALLBACK = Object.freeze({ estimated_tokens_before: 7700, estimated_tokens_after: 1750 });

/**
 * @param {string[]} basis what the estimate depends on
 * @returns {{ provenance: 'estimated', provenance_basis: string[] }}
 */
function estimated(basis) {
  return { provenance: PROVENANCE.ESTIMATED, provenance_basis: basis };
}

/** Basis line for policy-token numbers read from phase1 (or its hardcoded fallback). */
function policyTokenBasis(phase1Found) {
  return phase1Found
    ? 'policy tokens: bench/results/phase1-2026-08-29.json estimated_tokens_before/after (byte-count estimate)'
    : `policy tokens: hardcoded fallback ${POLICY_TOKEN_FALLBACK.estimated_tokens_before}/${POLICY_TOKEN_FALLBACK.estimated_tokens_after}`;
}

module.exports = { PROVENANCE, POLICY_TOKEN_FALLBACK, estimated, policyTokenBasis };
