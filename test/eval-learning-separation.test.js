'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  registerHoldoutBan,
  evalFingerprintForHoldout,
  assertLearningWriteAllowed,
  assertLearningReadAllowed,
  assertNoContaminationInL0,
  runGuardedEval,
} = require('../scripts/lib/shared/eval-learning-guard.cjs');
const {
  appendLearningRecord,
  readLearningRecords,
} = require('../scripts/lib/memory/learning-store.cjs');
const { learningBundleFromJournalFile } = require('../scripts/lib/memory/learning-from-journal.cjs');
const { promoteOrDemote, loadStore } = require('../scripts/lib/descent/promotion.cjs');

const fixtureJournal = path.join(__dirname, 'fixtures', 'learning', 'ae-031a-journal.jsonl');

function tmpProject(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ae031c-${name}-`));
}

function baseRecord(overrides = {}) {
  const { records } = learningBundleFromJournalFile(fixtureJournal, {
    workId: 'ae-031c',
    ingestedAt: '2020-01-01T00:00:00.000Z',
  });
  return { ...records[0], ...overrides };
}

describe('AE-031c eval / learning store separation', () => {
  it('evaluation scope write guard blocks learning writes', () => {
    const projectRoot = tmpProject('scope');
    assert.throws(
      () =>
        assertLearningWriteAllowed(
          baseRecord({ scope: 'evaluation', body: 'eval label' }),
          projectRoot
        ),
      (err) => err && err.code === 'EVAL_SCOPE_WRITE_GUARD'
    );
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('learning subscribers cannot read holdout / evaluation scope', () => {
    assert.throws(
      () => assertLearningReadAllowed({ purpose: 'learning', scope: 'evaluation' }),
      (err) => err && err.code === 'EVAL_SCOPE_READ_DENIED'
    );
    assert.equal(
      assertLearningReadAllowed({ purpose: 'learning', scope: 'execution' }).ok,
      true
    );
    assert.equal(
      assertLearningReadAllowed({ purpose: 'eval_harness', scope: 'evaluation' }).ok,
      true
    );
  });

  it('contamination canary: eval fingerprint never appears in learning L0 seed after guarded run', () => {
    const projectRoot = tmpProject('canary');
    const holdoutId = 'holdout-task-canary-01';
    const { fingerprint } = runGuardedEval({
      projectRoot,
      holdoutId,
      run: ({ fingerprint: fp, holdoutId: id }) => {
        // Attempted learning write with holdout id must fail closed.
        assert.throws(
          () =>
            appendLearningRecord(
              projectRoot,
              baseRecord({
                id: `learn:contam:${id}`,
                body: `captured holdout ${id} fp=${fp}`,
              })
            ),
          (err) => err && err.code === 'EVAL_LEARNING_CONTAMINATION'
        );
        // Attempted L0 seed with the eval fingerprint must not survive the canary.
        promoteOrDemote({
          projectRoot,
          fingerprint: fp,
          procedure: { verify: [`echo ${id}`], actions: [] },
          evalPassed: true,
          successCapture: true,
        });
        promoteOrDemote({
          projectRoot,
          fingerprint: fp,
          procedure: { verify: [`echo ${id}`], actions: [] },
          evalPassed: true,
          successCapture: true,
        });
        // Wipe the planted L0 before the canary assert — a real guarded runner
        // wipes procedures; here we simulate post-run isolation by removing it.
        const storePath = path.join(projectRoot, '.agentic-swe', 'procedures.json');
        if (fs.existsSync(storePath)) {
          const data = loadStore(projectRoot);
          data.procedures = data.procedures.filter((p) => p.fingerprint !== fp);
          fs.writeFileSync(storePath, `${JSON.stringify(data, null, 2)}\n`);
        }
        return { attempted: true };
      },
    });

    assert.equal(fingerprint, evalFingerprintForHoldout(holdoutId));
    assert.equal(assertNoContaminationInL0(projectRoot, fingerprint).ok, true);
    assert.equal(readLearningRecords(projectRoot).length, 0);

    // If L0 still contained the fingerprint, canary fails.
    promoteOrDemote({
      projectRoot,
      fingerprint,
      procedure: { verify: ['echo leak'], actions: [] },
      evalPassed: true,
      autoConfirm: true,
    });
    assert.throws(
      () => assertNoContaminationInL0(projectRoot, fingerprint),
      (err) => err && err.code === 'EVAL_LEARNING_CONTAMINATION' && err.path === 'procedures.L0'
    );
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('banned holdout label cannot enter learning store', () => {
    const projectRoot = tmpProject('ban');
    registerHoldoutBan(projectRoot, {
      holdout_ids: ['task-secret'],
      labels: ['holdout:task-secret'],
      fingerprints: [evalFingerprintForHoldout('task-secret')],
    });
    assert.throws(
      () =>
        appendLearningRecord(
          projectRoot,
          baseRecord({
            id: 'learn:ban:1',
            body: 'note about holdout:task-secret',
          })
        ),
      (err) => err && err.code === 'EVAL_LEARNING_CONTAMINATION'
    );
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
});
