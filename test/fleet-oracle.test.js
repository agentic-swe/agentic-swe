'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pluginRoot = path.resolve(__dirname, '..');

describe('fleet oracle', () => {
  it('ships fleet operator scripts and honest evidence classification', () => {
    for (const rel of [
      'scripts/fleet-onboard.cjs',
      'scripts/fleet-submit.cjs',
      'scripts/ingest-fleet-submission.cjs',
      'scripts/fleet-consumer-bootstrap.cjs',
      'scripts/fleet-independent-bootstrap.cjs',
      'scripts/fleet-export-invite.cjs',
      'scripts/fleet-sync-memory.cjs',
      'scripts/lib/fleet/submission-readiness.cjs',
      'scripts/lib/fleet/ingest-fleet-memory.cjs',
    ]) {
      assert.ok(fs.existsSync(path.join(pluginRoot, rel)), rel);
    }
    const { isIndependentFleetSubmission } = require('../scripts/lib/fleet/seed-organic-work.cjs');
    assert.equal(isIndependentFleetSubmission({ fleet_evidence_class: 'independent' }), true);
    assert.equal(isIndependentFleetSubmission({ fleet_evidence_class: 'maintainer_dogfood' }), false);
  });

  it('fleet skill is evaluated with oracle ref', () => {
    const skillPath = path.join(pluginRoot, 'skills', 'fleet', 'SKILL.md');
    assert.ok(fs.existsSync(skillPath));
    const raw = fs.readFileSync(skillPath, 'utf8');
    assert.match(raw, /eval_status: "evaluated"/);
    assert.match(raw, /oracle-fleet-pipeline/);
  });

  it('fleet-export-invite emits independent-class invite payload', () => {
    const { spawnSync } = require('node:child_process');
    const r = spawnSync(process.execPath, ['scripts/fleet-export-invite.cjs', '--json'], {
      cwd: pluginRoot,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.fleet_evidence_class, 'independent');
    assert.equal(payload.goal_complete, false);
    assert.ok(Array.isArray(payload.consumer_setup));
    assert.ok(payload.maintainer_status);
    assert.equal(payload.maintainer_status.fleet_scale_target, 3);
  });

  it('fleet-share-kit bundles invite and workflow template', () => {
    const { spawnSync } = require('node:child_process');
    const outDir = path.join(pluginRoot, 'bench', 'results', 'fleet-share-kit-test-tmp');
    const r = spawnSync(process.execPath, ['scripts/fleet-share-kit.cjs', '--out-dir', outDir, '--json'], {
      cwd: pluginRoot,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const manifest = JSON.parse(r.stdout);
    assert.equal(manifest.goal_complete, false);
    assert.ok(fs.existsSync(manifest.artifacts.invite));
    assert.ok(fs.existsSync(manifest.artifacts.workflow_template));
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('fleet-submit rejects independent class on maintainer_dogfood consumer', () => {
    const { spawnSync } = require('node:child_process');
    const dogfoodRoot = '/Users/surajg/hobby-projects/salesforce-agentic-swe';
    if (!fs.existsSync(dogfoodRoot)) return;
    const r = spawnSync(
      process.execPath,
      ['scripts/fleet-submit.cjs', '--project-root', dogfoodRoot, '--json'],
      {
        cwd: pluginRoot,
        encoding: 'utf8',
        env: { ...process.env, AGENTIC_SWE_FLEET_EVIDENCE_CLASS: 'independent' },
      }
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /maintainer_dogfood|independent class rejected/i);
  });
});
