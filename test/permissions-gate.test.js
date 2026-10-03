'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertPermissionsGate,
  assertPermissionsArtifactOrWaiver,
} = require('../scripts/lib/work-engine/permissions-gate.cjs');
const { fileNonEmpty } = require('../scripts/lib/work-engine/artifacts.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertArtifactsForTransition } = require('../scripts/lib/work-engine/artifacts.cjs');

describe('permissions gate', () => {
  it('blocks rigorous validation entry that skips permissions-check without waiver', () => {
    const r = assertPermissionsGate({
      from: 'self-review',
      to: 'validation',
      state: { pipeline: { track: 'rigorous' } },
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'PERMISSIONS_GATE');
  });

  it('allows permissions-check → validation on rigorous', () => {
    const r = assertPermissionsGate({
      from: 'permissions-check',
      to: 'validation',
      state: { pipeline: { track: 'rigorous' } },
    });
    assert.equal(r.ok, true);
  });

  it('allows waiver to enter validation from another state', () => {
    const r = assertPermissionsGate({
      from: 'code-review',
      to: 'validation',
      state: {
        pipeline: {
          track: 'rigorous',
          permissions_waiver: {
            actor: 'suraj',
            reason: 'emergency hotfix — permissions reviewed offline',
            at: '2026-10-03T00:00:00Z',
          },
        },
      },
    });
    assert.equal(r.ok, true);
  });

  it('allows leaving permissions-check with waiver and no artifact', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-waiver-'));
    const state = {
      pipeline: {
        track: 'rigorous',
        permissions_waiver: {
          actor: 'suraj',
          reason: 'no config surfaces changed',
          at: '2026-10-03T00:00:00Z',
        },
      },
    };
    const art = assertArtifactsForTransition(tmp, 'permissions-check', 'validation', state);
    assert.equal(art.ok, true);
    const gate = assertPermissionsArtifactOrWaiver({
      workDir: tmp,
      from: 'permissions-check',
      to: 'validation',
      state,
      fileNonEmpty,
    });
    assert.equal(gate.ok, true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
