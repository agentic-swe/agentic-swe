'use strict';

const { usdForUsage, getRates } = require('../work-engine/pricing.cjs');

/**
 * Session-level accounting from work-item budget.usage_totals / cost_used.
 * Billed-equivalent tokens convert USD to sonnet-input tokens so cache reads
 * are not counted 1:1 with uncached input.
 *
 * @param {object} state
 * @returns {{ has_session: boolean, usd: number, billed_equiv_input_tokens: number, raw_token_sum: number }}
 */
function historicalSessionAccounting(state) {
  const u = state?.budget?.usage_totals;
  const costUsed = Number(state?.budget?.cost_used || 0);
  if (!u || typeof u !== 'object') {
    return { has_session: false, usd: 0, billed_equiv_input_tokens: 0, raw_token_sum: 0 };
  }
  const raw_token_sum =
    Number(u.input_tokens || 0) +
    Number(u.output_tokens || 0) +
    Number(u.cache_read_input_tokens || 0) +
    Number(u.cache_creation_input_tokens || 0);
  const usd = costUsed > 0.001 ? costUsed : usdForUsage(u, 'sonnet');
  const inputRate = getRates('sonnet').inputPerMtok || 3;
  const billed_equiv_input_tokens = inputRate > 0 ? (usd / inputRate) * 1e6 : 0;
  return {
    has_session: usd > 0.01 || raw_token_sum > 1000,
    usd,
    billed_equiv_input_tokens,
    raw_token_sum,
  };
}

/**
 * @param {number} tokens
 * @returns {number} USD at sonnet input rate (warm replay approximation)
 */
function usdForWarmTokens(tokens) {
  return usdForUsage({ input_tokens: tokens }, 'sonnet');
}

module.exports = { historicalSessionAccounting, usdForWarmTokens };
