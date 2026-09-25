'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadJevConfig } = require('../scripts/lib/jev/config.cjs');
const { capState, classify } = require('../scripts/lib/jev/client.cjs');

const pluginRoot = path.join(__dirname, '..');

const QUESTIONS = {
  track: {
    type: 'choice',
    instructions: 'Pick a track.',
    criteria: { lean: 'small', standard: 'medium', rigorous: 'large' },
  },
};

function choiceBody(choice, confidence) {
  return {
    model: 'jev-1.13.0',
    answers: {
      track: {
        type: 'choice',
        choice,
        confidence,
        probabilities: { lean: 0.1, standard: 0.8, rigorous: 0.1 },
      },
    },
    usage: { input_tokens: 12, output_tokens: 3 },
    leak: 'should-not-be-audited',
  };
}

describe('jev client', () => {
  it('caps state and merges project config', () => {
    assert.strictEqual(capState('abcdef', 3), 'abc');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-cfg-'));
    fs.mkdirSync(path.join(tmp, '.agentic-swe'));
    fs.writeFileSync(
      path.join(tmp, '.agentic-swe', 'jev.json'),
      JSON.stringify({ timeout_ms: 50, state_cap: { track: 100 } })
    );
    const cfg = loadJevConfig(pluginRoot, tmp, { TYPESAFE_MODEL: 'jev-test' });
    assert.strictEqual(cfg.model, 'jev-test');
    assert.strictEqual(cfg.timeout_ms, 50);
    assert.strictEqual(cfg.state_cap.track, 100);
    assert.strictEqual(cfg.state_cap.tier, 4000);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('skips when disabled or the key is missing without calling fetch', async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      throw new Error('fetch should not run');
    };
    const disabled = await classify({
      pluginRoot,
      state: 'hello',
      questions: QUESTIONS,
      fetchImpl,
      env: { AGENTIC_SWE_JEV: '0', TYPESAFE_API_KEY: 'secret-key' },
    });
    assert.strictEqual(disabled.skipped, true);
    assert.strictEqual(disabled.reason, 'disabled');
    const missing = await classify({
      pluginRoot,
      state: 'hello',
      questions: QUESTIONS,
      fetchImpl,
      env: {},
    });
    assert.strictEqual(missing.reason, 'missing_key');
    assert.strictEqual(called, false);
  });

  it('reports timeout, http errors, and invalid bodies', async () => {
    const timeout = await classify({
      pluginRoot,
      state: 'hello',
      questions: QUESTIONS,
      config: { ...loadJevConfig(pluginRoot, null, {}), timeout_ms: 20, enabled: true },
      env: { TYPESAFE_API_KEY: 'secret-key' },
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
    assert.strictEqual(timeout.reason, 'timeout');

    const http = await classify({
      pluginRoot,
      state: 'hello',
      questions: QUESTIONS,
      env: { TYPESAFE_API_KEY: 'secret-key' },
      fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: 'secret-key' }) }),
    });
    assert.strictEqual(http.reason, 'http_error');

    const malformed = await classify({
      pluginRoot,
      state: 'hello',
      questions: QUESTIONS,
      env: { TYPESAFE_API_KEY: 'secret-key' },
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          throw new Error('secret-key not json');
        },
      }),
    });
    assert.strictEqual(malformed.reason, 'invalid_response');

    const invalid = await classify({
      pluginRoot,
      state: 'hello',
      questions: QUESTIONS,
      env: { TYPESAFE_API_KEY: 'secret-key' },
      fetchImpl: async () => ({ ok: true, json: async () => choiceBody('nope', 0.9) }),
    });
    assert.strictEqual(invalid.reason, 'invalid_response');
  });

  it('audits a successful call without the key or response body', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-audit-'));
    const key = 'super-secret-typesafe-key';
    let seenState = '';
    const result = await classify({
      pluginRoot,
      state: 'x'.repeat(50),
      stateCap: 8,
      questions: QUESTIONS,
      seam: 'classify',
      workDir: tmp,
      audit: true,
      env: { TYPESAFE_API_KEY: key },
      fetchImpl: async (_url, init) => {
        seenState = JSON.parse(init.body).state;
        assert.strictEqual(init.headers.Authorization, `Bearer ${key}`);
        return { ok: true, json: async () => ({ ...choiceBody('standard', 0.91), leak: key }) };
      },
    });
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.answers.track.choice, 'standard');
    assert.strictEqual(seenState.length, 8);
    const audit = fs.readFileSync(path.join(tmp, 'audit.log'), 'utf8');
    assert.match(audit, /actor=jev action=classify/);
    assert.match(audit, /reason=ok/);
    assert.match(audit, /input_tokens=12 output_tokens=3/);
    assert.strictEqual(audit.includes(key), false);
    assert.strictEqual(audit.includes('should-not-be-audited'), false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
