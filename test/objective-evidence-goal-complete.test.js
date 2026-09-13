'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('objective-evidence goal_complete derivation', () => {
  it('goal_complete equals scorecard_all_met', () => {
    function deriveGoalComplete(requirements) {
      const scorecardAllMet = requirements.every((r) => r.status === 'met');
      return scorecardAllMet;
    }

    const incomplete = [
      { id: 'a', status: 'met' },
      { id: 'fleet-scale-independent', status: 'incomplete' },
    ];
    const complete = [
      { id: 'a', status: 'met' },
      { id: 'fleet-scale-independent', status: 'met' },
    ];
    assert.equal(deriveGoalComplete(incomplete), false);
    assert.equal(deriveGoalComplete(complete), true);
  });
});
