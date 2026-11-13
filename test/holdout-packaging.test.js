'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  hashTaskContent,
  wipeEvalStores,
  prepareColdHoldoutRun,
  loadHiddenOracle,
  assertNoL0ForHoldout,
  verifyTaskContentPin,
} = require('../scripts/lib/bench/holdout-packaging.cjs');
const {
  validateEvalManifestFile,
  computeManifestDigest,
} = require('../scripts/lib/bench/eval-manifest.cjs');
const { promoteOrDemote, loadStore } = require('../scripts/lib/descent/promotion.cjs');
const { evalFingerprintForHoldout } = require('../scripts/lib/memory/eval-learning-guard.cjs');

const root = path.join(__dirname, '..');

function tmpProject(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ae034b-${name}-`));
}

describe('AE-034b holdout packaging + isolation', () => {
  it('dev-smoke and public-holdout manifests pin real content hashes', () => {
    for (const name of ['dev-smoke.json', 'public-holdout.json']) {
      const file = path.join(root, 'bench', 'manifests', name);
      const result = validateEvalManifestFile(file, { repoRoot: root });
      assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(manifest.manifest_digest, computeManifestDigest(manifest));
      assert.equal(manifest.cold_run_required, true);
      for (const task of manifest.tasks) {
        const pin = verifyTaskContentPin(task, root);
        assert.equal(pin.ok, true, JSON.stringify(pin));
        assert.equal(task.content_sha256, hashTaskContent(path.join(root, task.path)));
      }
    }
  });

  it('scoring applies hidden oracle only in the score phase', () => {
    const taskDir = path.join(root, 'bench', 'tasks', '01-off-by-one');
    assert.throws(
      () => loadHiddenOracle(taskDir, { phase: 'run' }),
      (err) => err && err.code === 'HIDDEN_ORACLE_PHASE'
    );
    assert.throws(
      () => loadHiddenOracle(taskDir, { phase: 'agent' }),
      (err) => err && err.code === 'HIDDEN_ORACLE_PHASE'
    );
    const oracle = loadHiddenOracle(taskDir, { phase: 'score' });
    assert.ok(oracle.task_pass);
    assert.equal(oracle.task_pass.method, 'run_acceptance_tests');
  });

  it('cold wipe clears procedures and memory before eval run', () => {
    const projectRoot = tmpProject('wipe');
    fs.mkdirSync(path.join(projectRoot, '.agentic-swe'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.agentic-swe', 'procedures.json'),
      JSON.stringify({ procedures: [{ fingerprint: 'x', tier: 'L0' }] })
    );
    fs.writeFileSync(path.join(projectRoot, '.agentic-swe', 'memory.sqlite'), 'not-a-db');
    const wiped = wipeEvalStores(projectRoot);
    assert.equal(wiped.ok, true);
    assert.deepEqual(loadStore(projectRoot).procedures, []);
    assert.equal(fs.existsSync(path.join(projectRoot, '.agentic-swe', 'memory.sqlite')), false);
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('eval run adds no L0 for a holdout id', () => {
    const projectRoot = tmpProject('nol0');
    const holdoutId = '01-off-by-one';
    prepareColdHoldoutRun({ projectRoot, holdoutIds: [holdoutId], e8Cited: true });
    assert.equal(assertNoL0ForHoldout(projectRoot, holdoutId).ok, true);

    // Planting L0 with the eval fingerprint fails the gate.
    const fp = evalFingerprintForHoldout(holdoutId);
    promoteOrDemote({
      projectRoot,
      fingerprint: fp,
      procedure: { verify: ['npm test'], actions: [] },
      evalPassed: true,
      autoConfirm: true,
    });
    assert.throws(
      () => assertNoL0ForHoldout(projectRoot, holdoutId),
      (err) => err && err.code === 'EVAL_LEARNING_CONTAMINATION'
    );
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('E8-cited prepareColdHoldoutRun always wipes (C4)', () => {
    const projectRoot = tmpProject('e8');
    fs.mkdirSync(path.join(projectRoot, '.agentic-swe'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, '.agentic-swe', 'procedures.json'),
      JSON.stringify({
        procedures: [{ fingerprint: 'warm', tier: 'L0', procedure: {} }],
      })
    );
    prepareColdHoldoutRun({
      projectRoot,
      holdoutIds: ['02-add-retry'],
      e8Cited: true,
    });
    assert.deepEqual(loadStore(projectRoot).procedures, []);
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
});
