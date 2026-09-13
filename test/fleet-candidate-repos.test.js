'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanCandidateRepos } = require('../scripts/fleet-candidate-repos.cjs');

describe('fleet-candidate-repos', () => {
  it('marks archived dogfood siblings ineligible and leaves other git repos eligible', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-cands-'));
    const parent = path.join(tmp, 'parent');
    const pluginRoot = path.join(tmp, 'pack');
    const archiveDir = path.join(pluginRoot, 'bench', 'results', 'fleet-submissions');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.mkdirSync(parent, { recursive: true });

    const dogfoodNames = ['dogfood-a', 'dogfood-b', 'dogfood-c'];
    for (const name of dogfoodNames) {
      const repoRoot = path.join(parent, name);
      fs.mkdirSync(path.join(repoRoot, '.git'), { recursive: true });
      fs.writeFileSync(
        path.join(archiveDir, `${name}.json`),
        JSON.stringify({
          fleet_evidence_class: 'maintainer_dogfood',
          project_root: repoRoot,
        })
      );
    }
    const eligibleRoot = path.join(parent, 'external-consumer');
    fs.mkdirSync(path.join(eligibleRoot, '.git'), { recursive: true });

    const r = scanCandidateRepos({ pluginRoot, parentDir: parent });
    assert.equal(r.ok, true);
    assert.equal(r.goal_complete, false);
    assert.ok(r.fleet_scale);
    const dogfood = r.candidates.filter((c) => c.maintainer_dogfood_archived);
    assert.ok(dogfood.length >= 3);
    for (const row of dogfood) {
      assert.equal(row.eligible_for_independent, false);
    }
    const eligible = r.candidates.filter((c) => c.eligible_for_independent);
    assert.ok(eligible.length >= 1);
    assert.ok(eligible.some((c) => c.name === 'external-consumer'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
