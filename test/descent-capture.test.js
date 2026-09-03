'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  isValidationApproved,
  extractVerifyCommands,
  captureProcedureFromWork,
} = require('../scripts/lib/descent/capture-procedure.cjs');
const { promoteOrDemote, loadStore } = require('../scripts/lib/descent/promotion.cjs');
const { buildFingerprint } = require('../scripts/lib/descent/fingerprint.cjs');

describe('capture-procedure', () => {
  const tmp = path.join(__dirname, '_tmp-capture');

  function setupWork(validationBody) {
    fs.rmSync(tmp, { recursive: true, force: true });
    const workDir = path.join(tmp, '.worklogs', 'w1');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'validation-results.md'),
      validationBody,
      'utf8'
    );
    fs.writeFileSync(
      path.join(workDir, 'implementation.md'),
      '# Implementation\n\n- `src/foo.js`\n\n```bash\nnpm test\n```\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({ current_state: 'validation', work_id: 'w1' }, null, 2),
      'utf8'
    );
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'foo.js'), 'module.exports = 1;\n', 'utf8');
    return workDir;
  }

  it('detects approved validation', () => {
    assert.strictEqual(isValidationApproved('classification: `approved`'), true);
    assert.strictEqual(isValidationApproved('classification: failed'), false);
    assert.strictEqual(
      isValidationApproved('Status: PASS — proceed to pr-creation'),
      true
    );
    assert.ok(isValidationApproved('## Verdict\n\n**PASS** — ready for pr-creation.\n'));
    assert.ok(isValidationApproved('**Classification**: approved\n'));
    assert.ok(isValidationApproved('## Verdict\n\n**Approved** for merge to main\n'));
  });

  it('extracts verify commands from validation artifact', () => {
    const cmds = extractVerifyCommands('Ran `npm test` and `node scripts/lint.cjs`');
    assert.ok(cmds.includes('npm test'));
  });

  it('captures L1 procedure on first approved validation', () => {
    const workDir = setupWork('# Validation\n\nclassification: `approved`\n\n```bash\nnpm test\n```\n');
    const r = captureProcedureFromWork({ workDir, projectRoot: tmp, storeRoot: tmp });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.tier, 'L1');
    assert.strictEqual(r.verifyCommand, 'npm test');
    const store = loadStore(tmp);
    assert.strictEqual(store.procedures.length, 1);
    assert.strictEqual(store.procedures[0].eval_status, 'evaluated');
    const reads = store.procedures[0].procedure.actions.filter((a) => a.type === 'READ_FILE');
    assert.strictEqual(reads.length, 1);
    assert.strictEqual(reads[0].path, 'src/foo.js');
  });

  it('auto-promotes to L0 after two success captures', () => {
    const fp = buildFingerprint({ files: ['w1'], verifyCommand: 'npm test' });
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: fp,
      procedure: { verify: [{ type: 'RUN', command: 'npm test' }] },
      evalPassed: true,
      successCapture: true,
    });
    const r2 = promoteOrDemote({
      projectRoot: tmp,
      fingerprint: fp,
      procedure: { verify: [{ type: 'RUN', command: 'npm test' }] },
      evalPassed: true,
      successCapture: true,
    });
    assert.strictEqual(r2.record.tier, 'L0');
    assert.strictEqual(r2.record.success_count, 2);
  });
});

describe('descent holdout bench script', () => {
  it('runs without error', () => {
    const { spawnSync } = require('node:child_process');
    const script = path.join(__dirname, '..', 'scripts', 'bench', 'run-descent-holdout.cjs');
    const out = path.join(__dirname, '_tmp-holdout.json');
    const r = spawnSync(process.execPath, [script, '--out', out], {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..'),
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const payload = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(payload.summary.holdout_total >= 7);
    assert.strictEqual(payload.summary.corpus_circular_benchmark, false);
    fs.unlinkSync(out);
  });
});
