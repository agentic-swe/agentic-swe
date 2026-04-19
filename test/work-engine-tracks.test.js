'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { assertTransition } = require('../scripts/lib/work-engine/transitions.cjs');

const pluginRoot = path.join(__dirname, '..');

describe('work-engine transitions + tracks', () => {
  it('allows lean-track-check → lean-track-implementation on lean track', () => {
    const r = assertTransition(pluginRoot, 'lean-track-check', 'lean-track-implementation', 'lean');
    assert.strictEqual(r.ok, true);
  });

  it('forbids lean-track-check → lean-track-implementation on rigorous (missing track)', () => {
    const r = assertTransition(pluginRoot, 'lean-track-check', 'lean-track-implementation', null);
    assert.strictEqual(r.ok, false);
  });

  it('forbids lean-track-check → design on lean track', () => {
    const r = assertTransition(pluginRoot, 'lean-track-check', 'design', 'lean');
    assert.strictEqual(r.ok, false);
  });

  it('allows self-review → validation on standard', () => {
    const r = assertTransition(pluginRoot, 'self-review', 'validation', 'standard');
    assert.strictEqual(r.ok, true);
  });

  it('forbids self-review → validation on rigorous', () => {
    const r = assertTransition(pluginRoot, 'self-review', 'validation', 'rigorous');
    assert.strictEqual(r.ok, false);
  });
});
