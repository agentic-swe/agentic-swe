'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  extractTransitionLines,
  edgeSetFromLines,
  edgeSetFromCanonical,
} = require('../scripts/lib/state-machine-edges.cjs');

const root = path.join(__dirname, '..');
const goalMd = path.join(root, 'commands', 'goal.md');
const canonicalPath = path.join(root, 'goal-state-machine.json');

describe('goal-state-machine.json matches commands/goal.md transition block', () => {
  it('edge sets are identical', () => {
    const body = fs.readFileSync(goalMd, 'utf8');
    const fromMd = edgeSetFromLines(extractTransitionLines(body));

    const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
    const fromJson = edgeSetFromCanonical(canonical);

    const onlyMd = [...fromMd].filter((e) => !fromJson.has(e));
    const onlyJson = [...fromJson].filter((e) => !fromMd.has(e));

    assert.deepStrictEqual(
      onlyMd.sort(),
      [],
      `Edges in goal.md but not goal-state-machine.json: ${onlyMd.join('; ')}`
    );
    assert.deepStrictEqual(
      onlyJson.sort(),
      [],
      `Edges in goal-state-machine.json but not goal.md: ${onlyJson.join('; ')}`
    );
  });
});
