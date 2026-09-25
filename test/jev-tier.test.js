'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { adviseModelTier, renderModelTierHint } = require('../scripts/lib/jev/tier.cjs');

const pluginRoot = require('node:path').join(__dirname, '..');

function baseline() {
  return renderModelTierHint({ wid: 'add-retry', phase: 'feasibility', phaseTier: 'fast', advice: null });
}

function tierResponse(choice, confidence) {
  return {
    ok: true,
    json: async () => ({
      model: 'jev-1.13.0',
      answers: {
        tier: {
          type: 'choice',
          choice,
          confidence,
          probabilities: { fast: 0.1, balanced: 0.2, heavy: 0.7 },
        },
      },
      usage: { input_tokens: 8, output_tokens: 2 },
    }),
  };
}

describe('jev model tier', () => {
  it('matches the pre-Jev hint when Jev is skipped', async () => {
    const advice = await adviseModelTier({
      pluginRoot,
      phase: 'feasibility',
      phaseTier: 'fast',
      task: 'Fix a typo in the readme',
      env: {},
      fetchImpl: async () => {
        throw new Error('should not fetch');
      },
    });
    assert.strictEqual(advice.follow, 'fast');
    assert.strictEqual(advice.source, 'phase');
    const rendered = renderModelTierHint({
      wid: 'add-retry',
      phase: 'feasibility',
      phaseTier: 'fast',
      advice,
    });
    assert.strictEqual(rendered, baseline());
    assert.match(rendered, /→ \*\*tier:\*\* `fast`/);
    assert.strictEqual(rendered.includes('Jev'), false);
  });

  it('follows a confident Jev tier and keeps the phase tier on low confidence', async () => {
    const confident = await adviseModelTier({
      pluginRoot,
      phase: 'feasibility',
      phaseTier: 'fast',
      task: 'Redesign the auth boundary',
      env: { TYPESAFE_API_KEY: 'secret-key' },
      fetchImpl: async () => tierResponse('heavy', 0.88),
    });
    assert.strictEqual(confident.follow, 'heavy');
    assert.strictEqual(confident.source, 'jev');
    const confidentText = renderModelTierHint({
      wid: 'add-retry',
      phase: 'feasibility',
      phaseTier: 'fast',
      advice: confident,
    });
    assert.match(confidentText, /### Model routing \(Phase 3 policy, Jev advisory\)/);
    assert.match(confidentText, /→ \*\*tier:\*\* `heavy`/);
    assert.match(confidentText, /Phase tier: `fast`/);

    const low = await adviseModelTier({
      pluginRoot,
      phase: 'feasibility',
      phaseTier: 'fast',
      task: 'Redesign the auth boundary',
      env: { TYPESAFE_API_KEY: 'secret-key' },
      fetchImpl: async () => tierResponse('heavy', 0.33),
    });
    assert.strictEqual(low.follow, 'fast');
    assert.strictEqual(low.jev.skipped, 'low_confidence');
    const lowText = renderModelTierHint({
      wid: 'add-retry',
      phase: 'feasibility',
      phaseTier: 'fast',
      advice: low,
    });
    assert.match(lowText, /→ \*\*tier:\*\* `fast`/);
    assert.match(lowText, /skipped \(low_confidence\)/);
  });
});
