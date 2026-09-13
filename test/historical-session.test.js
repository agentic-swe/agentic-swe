'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { historicalSessionAccounting, usdForWarmTokens } = require('../scripts/lib/descent/historical-session.cjs');
const { usdForUsage } = require('../scripts/lib/work-engine/pricing.cjs');

describe('historical session accounting', () => {
  it('matches TUI-scale billed USD from usage_totals', () => {
    const usage = {
      input_tokens: 303,
      output_tokens: 182030,
      cache_read_input_tokens: 39749583,
      cache_creation_input_tokens: 1426693,
    };
    const usd = usdForUsage(usage, 'sonnet');
    assert.ok(usd > 19 && usd < 22, `expected ~$20, got ${usd}`);
    const acc = historicalSessionAccounting({
      budget: { cost_used: 20.006333, usage_totals: usage },
    });
    assert.equal(acc.has_session, true);
    assert.equal(acc.usd, 20.006333);
    assert.ok(acc.billed_equiv_input_tokens > 1e6);
    const warm = usdForWarmTokens(1750);
    assert.ok(warm / acc.usd < 0.02);
  });

  it('has_session false without usage', () => {
    const acc = historicalSessionAccounting({ budget: {} });
    assert.equal(acc.has_session, false);
  });
});
