'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  adviseSkillNouls,
  adviseSubagentChoice,
  appendJevSkillLines,
  catalogJevSuffix,
  interpretChoice,
  interpretSkillNouls,
} = require('../scripts/lib/jev/rerank.cjs');
const { loadJevConfig } = require('../scripts/lib/jev/config.cjs');

const pluginRoot = path.join(__dirname, '..');
const config = loadJevConfig(pluginRoot, null, {});

describe('jev rerank', () => {
  it('keeps retrieval order in results and records a confident choice separately', async () => {
    const candidates = [
      { id: 'demo/alpha', text: 'alpha widgets' },
      { id: 'demo/beta', text: 'beta gizmos' },
    ];
    const snapshot = structuredClone(candidates);
    const advised = await adviseSubagentChoice({
      pluginRoot,
      query: 'terraform gizmos',
      candidates,
      env: { TYPESAFE_API_KEY: 'secret-key' },
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          model: 'jev-1.13.0',
          answers: {
            pick: {
              type: 'choice',
              choice: 'demo/beta',
              confidence: 0.86,
              probabilities: { 'demo/alpha': 0.14, 'demo/beta': 0.86 },
            },
          },
          usage: { input_tokens: 11, output_tokens: 2 },
        }),
      }),
    });
    assert.deepStrictEqual(candidates, snapshot);
    assert.deepStrictEqual(advised.jev.order, ['demo/beta', 'demo/alpha']);
    assert.strictEqual(advised.jev.applied, true);
    assert.deepStrictEqual(catalogJevSuffix({ skipped: 'missing_key', applied: false }), []);
    assert.deepStrictEqual(catalogJevSuffix(advised.jev), ['jev\tdemo/beta\t0.86']);
  });

  it('preserves order on low confidence, timeout, and weak skill nouls', async () => {
    const candidates = [
      { id: 'demo/alpha', text: 'alpha' },
      { id: 'demo/beta', text: 'beta' },
    ];
    const low = interpretChoice(
      candidates,
      {
        skipped: false,
        model: 'jev-1.13.0',
        answers: {
          pick: {
            type: 'choice',
            choice: 'demo/beta',
            confidence: 0.2,
            probabilities: { 'demo/alpha': 0.8, 'demo/beta': 0.2 },
          },
        },
      },
      config
    );
    assert.deepStrictEqual(low.order, ['demo/alpha', 'demo/beta']);
    assert.strictEqual(low.skipped, 'low_confidence');
    assert.strictEqual(low.applied, false);

    const skills = [
      { name: 'alpha', kind: 'command' },
      { name: 'beta', kind: 'command' },
    ];
    const weak = interpretSkillNouls(
      skills,
      {
        skipped: false,
        model: 'jev-1.13.0',
        answers: {
          alpha: { type: 'noul', noul: 0.2 },
          beta: { type: 'noul', noul: 0.3 },
        },
      },
      config
    );
    assert.deepStrictEqual(weak.order, ['alpha', 'beta']);
    assert.strictEqual(weak.order[0], 'alpha');
    assert.strictEqual(weak.skipped, 'low_confidence');

    const strong = interpretSkillNouls(
      skills,
      {
        skipped: false,
        model: 'jev-1.13.0',
        answers: {
          alpha: { type: 'noul', noul: 0.2 },
          beta: { type: 'noul', noul: 0.91 },
        },
      },
      config
    );
    assert.deepStrictEqual(strong.order, ['beta', 'alpha']);
    const lines = [];
    appendJevSkillLines(lines, strong);
    assert.match(lines.join('\n'), /### Skill route \(Jev advisory\)/);
    assert.match(lines.join('\n'), /`beta` noul=0.91/);

    const timed = await adviseSkillNouls({
      pluginRoot,
      query: 'retry',
      results: skills,
      env: { TYPESAFE_API_KEY: 'secret-key' },
      config: { ...config, timeout_ms: 20 },
      fetchImpl: (_url, init) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({ ok: true, json: async () => ({}) }), 5000);
          init.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    });
    assert.deepStrictEqual(timed.jev.order, ['alpha', 'beta']);
    assert.strictEqual(timed.jev.skipped, 'timeout');
    assert.strictEqual(timed.jev.applied, false);
    const skipLines = [];
    appendJevSkillLines(skipLines, timed.jev);
    assert.match(skipLines.join('\n'), /skipped \(timeout\)/);
  });
});
