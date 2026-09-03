'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runFleetOnboard } = require('../scripts/fleet-onboard.cjs');
const { buildSubmissionReadiness } = require('../scripts/lib/fleet/submission-readiness.cjs');
const { scaffoldProjectSkillFromRitual } = require('../scripts/lib/skills/project-skills.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('fleet-onboard', () => {
  it('warms consumer repo memory and reports goal_complete false', async () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-on-'));
    scaffoldProjectSkillFromRitual({
      projectRoot: tmpProj,
      skillName: 'team-lint',
      verifyCommand: 'npm run team-lint',
    });

    const payload = await runFleetOnboard({
      projectRoot: tmpProj,
      pluginRoot,
      skipSessions: true,
      evolve: false,
    });

    assert.equal(payload.goal_complete, false);
    assert.equal(payload.consumer_mode, true);
    assert.equal(payload.doctor.ok, true);
    assert.equal(payload.memory.project_skills.skills, 1);
    assert.equal(payload.submission_readiness.fleet_submission_ready, false);
    assert.ok(payload.submission_readiness.blockers.length >= 1);
    assert.ok(payload.env_recommendations.some((l) => l.includes('AGENTIC_SWE_PROJECT_ROOT')));
    assert.ok(Array.isArray(payload.consumer_checklist.steps));
    assert.ok(payload.consumer_checklist.steps.length >= 3);

    fs.rmSync(tmpProj, { recursive: true, force: true });
  });
});

describe('buildSubmissionReadiness', () => {
  it('requires consumer-repo bench artifact when evaluating pack root', () => {
    const readiness = buildSubmissionReadiness({
      projectRoot: pluginRoot,
      pluginRoot,
      muscleMemoryOk: true,
    });
    assert.equal(readiness.fleet_submission_ready, false);
    assert.ok(
      readiness.blockers.some((b) => b.includes('consumer repo') || b.includes('consumer-repo-descent'))
    );
  });

  it('blocks organic work items that lack tier_totals', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sub-tier-'));
    const verify = 'npm test';
    for (const id of ['w-a', 'w-b', 'w-c']) {
      const workDir = path.join(tmp, '.worklogs', id);
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(
        path.join(workDir, 'state.json'),
        JSON.stringify({
          work_id: id,
          current_state: 'completed',
          history: [
            { actor: 'engineer', from: 'implementation', to: 'validation' },
            { actor: 'user', from: 'pr-creation', to: 'completed' },
          ],
        })
      );
    }
    const readiness = buildSubmissionReadiness({
      projectRoot: tmp,
      pluginRoot,
      muscleMemoryOk: true,
    });
    assert.equal(readiness.organic_live, 3);
    assert.equal(readiness.organic_with_tier_totals, 0);
    assert.equal(readiness.fleet_submission_ready, false);
    assert.ok(readiness.blockers.some((b) => b.includes('tier_totals')));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('fleet-submit', () => {
  it('exits 0 for consumer repo passing submission gate', () => {
    const { spawnSync } = require('node:child_process');
    const { emptyTierTotals } = require('../scripts/lib/bench/tier-totals.cjs');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-sub-'));
    const verify = 'npm test';
    for (const id of ['feat-sub-a', 'feat-sub-b', 'feat-sub-c']) {
      const workDir = path.join(tmp, '.worklogs', id);
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(
        path.join(workDir, 'state.json'),
        JSON.stringify({
          work_id: id,
          current_state: 'completed',
          budget: { tier_totals: emptyTierTotals() },
          history: [
            { actor: 'engineer', from: 'implementation', to: 'validation' },
            { actor: 'user', from: 'pr-creation', to: 'completed' },
          ],
        })
      );
    }
    const out = path.join(tmp, 'fleet-submission.json');
    const r = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts/fleet-submit.cjs'), '--project-root', tmp, '--out', out],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const payload = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(payload.fleet_submission_ready, true);
    assert.equal(payload.goal_complete, false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
