'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertArtifactsForTransition } = require('../scripts/lib/work-engine/artifacts.cjs');

describe('rigorous design panel artifacts', () => {
  it('blocks leaving design without design-panel-review.md on rigorous', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-art-'));
    fs.writeFileSync(path.join(tmp, 'design.md'), '# Design\n\nok\n');
    const r = assertArtifactsForTransition(tmp, 'design', 'design-review', {
      pipeline: { track: 'rigorous' },
    });
    assert.equal(r.ok, false);
    assert.match(r.message, /design-panel-review/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('allows leaving design with panel file on rigorous', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-art-ok-'));
    fs.writeFileSync(path.join(tmp, 'design.md'), '# Design\n\nok\n');
    fs.writeFileSync(
      path.join(tmp, 'design-panel-review.md'),
      '# Panel\n\n- architect: approve\n- security: approve\n- adversarial: dissent noted\n'
    );
    const r = assertArtifactsForTransition(tmp, 'design', 'design-review', {
      pipeline: { track: 'rigorous' },
    });
    assert.equal(r.ok, true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('does not require panel on standard track', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-std-'));
    fs.writeFileSync(path.join(tmp, 'design.md'), '# Design\n\nok\n');
    const r = assertArtifactsForTransition(tmp, 'design', 'verification', {
      pipeline: { track: 'standard' },
    });
    assert.equal(r.ok, true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
