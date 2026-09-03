'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  isHoldoutTask,
  purgeHoldoutCorpusSeeds,
  captureHoldoutFromValidation,
  accumulateDeliveredHoldout,
} = require('../scripts/lib/descent/holdout-capture.cjs');
const { DEFAULT_STORE } = require('../scripts/lib/descent/promotion.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('holdout capture', () => {
  it('isHoldoutTask identifies ritual and mined prefixes', () => {
    assert.equal(isHoldoutTask('mined-trivial-pass'), true);
    assert.equal(isHoldoutTask('ritual-version-sync-a'), true);
    assert.equal(isHoldoutTask('oracle-version-check'), false);
  });

  it('accumulateDeliveredHoldout captures delivered holdout only', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'holdout-cap-'));
    const storePath = path.join(tmpRoot, DEFAULT_STORE);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify({ procedures: [] }, null, 2));

    const r = accumulateDeliveredHoldout({ pluginRoot, projectRoot: tmpRoot, purge: false });
    assert.equal(r.ok, true);
    assert.ok(r.delivered >= 3, `expected 3+ delivered captures, got ${r.delivered}`);
    assert.ok(r.captures.some((c) => c.task === 'mined-trivial-pass'));

    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const holdoutRecs = store.procedures.filter((p) =>
      p.procedure?._meta?.source === 'validation-approved'
    );
    assert.ok(holdoutRecs.length >= 3);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('purgeHoldoutCorpusSeeds removes circular holdout seeds', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'holdout-purge-'));
    const storePath = path.join(tmpRoot, DEFAULT_STORE);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(
      storePath,
      JSON.stringify(
        {
          procedures: [
            {
              fingerprint: 'abc',
              tier: 'L0',
              procedure: {
                verify: [{ command: 'npm test' }],
                _meta: {
                  taskDir: path.join(pluginRoot, 'bench/corpus/mined-trivial-pass'),
                  method: 'run_command',
                },
              },
            },
            {
              fingerprint: 'def',
              tier: 'L0',
              procedure: {
                verify: [{ command: 'npm test' }],
                _meta: { source: 'validation-approved', task: 'mined-trivial-pass' },
              },
            },
          ],
        },
        null,
        2
      )
    );

    const purged = purgeHoldoutCorpusSeeds(tmpRoot);
    assert.equal(purged.removed, 1);
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    assert.equal(store.procedures.length, 1);
    assert.equal(store.procedures[0].procedure._meta.source, 'validation-approved');

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('captureHoldoutFromValidation skips failing holdout', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'holdout-skip-'));
    const storePath = path.join(tmpRoot, DEFAULT_STORE);
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, JSON.stringify({ procedures: [] }, null, 2));

    const r = captureHoldoutFromValidation({
      pluginRoot,
      projectRoot: tmpRoot,
      taskName: 'mined-trivial-fail',
    });
    assert.equal(r.ok, false);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
});
