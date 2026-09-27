'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { distillSessionChunk } = require('../scripts/lib/memory/session-capture.cjs');
const { isWellFormedCommand, quarantineProcedures } = require('../scripts/lib/descent/procedure-hygiene.cjs');
const { isReplayEligible } = require('../scripts/lib/descent/ladder.cjs');
const { runIncrementalIndex } = require('../scripts/lib/memory/incremental-index.cjs');
const { runMaintenance } = require('../scripts/lib/hooks/lifecycle.cjs');
const { readHookNotice } = require('../scripts/lib/hooks/hook-receipt.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('evidence-scored capture', () => {
  it('keeps explicit decisions and lessons', () => {
    const distilled = distillSessionChunk({
      text: 'Decision: use work-engine for all transitions. Lesson: always run npm test.',
      workId: 'demo',
    });
    assert.ok(distilled.nodes.some((node) => node.kind === 'decision'));
    assert.ok(distilled.nodes.some((node) => node.kind === 'lesson'));
    assert.ok(distilled.nodes.every((node) => node.score >= 0.45));
  });

  it('does not store a long transcript that has no evidence', () => {
    const distilled = distillSessionChunk({
      text: 'We talked through the release for a while and the conversation wandered across several topics without recording a decision, a lesson, a path, or a command.',
    });
    assert.equal(distilled.nodes.length, 0);
  });

  it('rejects transcript prose that only looks like a command', () => {
    const distilled = distillSessionChunk({
      text: 'npm dependencies. The publish notes wandered through the registry without a real command or a file path.',
    });
    assert.equal(distilled.nodes.length, 0);
    assert.equal(isWellFormedCommand('npm dependencies.'), false);
    assert.equal(isWellFormedCommand('npm test to verify the retry logic implementation.'), false);
  });

  it('stores a pattern when a runnable command has an outcome', () => {
    const distilled = distillSessionChunk({
      text: 'Verified the change passed by running node --test test/memory-phase3.test.js.',
    });
    assert.equal(distilled.nodes.length, 1);
    assert.equal(distilled.nodes[0].kind, 'pattern');
  });
});

describe('procedure hygiene', () => {
  it('quarantines malformed and duplicate records without deleting them', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proc-hyg-'));
    const dir = path.join(tmp, '.agentic-swe');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'procedures.json'), JSON.stringify({
      procedures: [
        { fingerprint: 'good', tier: 'L0', eval_status: 'evaluated', success_count: 4, procedure: { actions: [], verify: [{ type: 'RUN', command: 'npm test' }] } },
        { fingerprint: 'dup', tier: 'L1', eval_status: 'unevaluated', procedure: { actions: [], verify: [{ type: 'RUN', command: 'npm test' }] } },
        { fingerprint: 'bad', tier: 'L1', eval_status: 'unevaluated', procedure: { actions: [], verify: [{ type: 'RUN', command: 'npm dependencies.' }] } },
      ],
    }));
    const result = quarantineProcedures(tmp);
    assert.equal(result.rejected, 1);
    assert.equal(result.duplicates, 1);
    const stored = JSON.parse(fs.readFileSync(path.join(dir, 'procedures.json'), 'utf8'));
    const good = stored.procedures.find((rec) => rec.fingerprint === 'good');
    const dup = stored.procedures.find((rec) => rec.fingerprint === 'dup');
    const bad = stored.procedures.find((rec) => rec.fingerprint === 'bad');
    assert.equal(good.eval_status, 'evaluated');
    assert.equal(isReplayEligible(good), true);
    assert.equal(dup.quality, 'duplicate');
    assert.equal(isReplayEligible(dup), false);
    assert.equal(bad.quality, 'rejected');
    assert.equal(isReplayEligible(bad), false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('incremental index and hook receipts', () => {
  it('indexes a changed doc and records a receipt', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'incr-idx-'));
    fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'docs', 'note.md'), '# Note\n\nFirst body.\n');
    const first = await runIncrementalIndex({ projectRoot: tmp, pluginRoot, limit: 5 });
    assert.equal(first.updated, 1);
    const second = await runIncrementalIndex({ projectRoot: tmp, pluginRoot, limit: 5 });
    assert.equal(second.updated, 0);

    const maintained = await runMaintenance({ projectRoot: tmp, pluginRoot, hook: 'start' });
    assert.equal(maintained.ok, true);
    assert.equal(readHookNotice(tmp), '');
    assert.ok(fs.existsSync(path.join(tmp, '.agentic-swe', 'lessons.json')));
    assert.ok(fs.existsSync(path.join(tmp, '.agentic-swe', 'hook-receipts.jsonl')));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
