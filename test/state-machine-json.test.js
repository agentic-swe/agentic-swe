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
const claudeMd = path.join(root, 'CLAUDE.md');
const canonicalPath = path.join(root, '.claude', 'state-machine.json');

describe('state-machine.json matches CLAUDE.md transition block', () => {
  it('edge sets are identical', () => {
    const body = fs.readFileSync(claudeMd, 'utf8');
    const lines = extractTransitionLines(body);
    const fromMd = edgeSetFromLines(lines);

    const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf8'));
    const fromJson = edgeSetFromCanonical(canonical);

    const onlyMd = [...fromMd].filter((e) => !fromJson.has(e));
    const onlyJson = [...fromJson].filter((e) => !fromMd.has(e));

    assert.deepStrictEqual(
      onlyMd.sort(),
      [],
      `Edges in CLAUDE.md but not state-machine.json: ${onlyMd.join('; ')}`
    );
    assert.deepStrictEqual(
      onlyJson.sort(),
      [],
      `Edges in state-machine.json but not CLAUDE.md: ${onlyJson.join('; ')}`
    );
  });
});
