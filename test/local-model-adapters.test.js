'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  createModelGateway,
  createOllamaAdapter,
  createLlamaCppAdapter,
  runConformanceSuite,
} = require('../scripts/lib/model-gateway/index.cjs');
const { evaluate } = require('../scripts/lib/policy/pdp.cjs');
const policy = require('./fixtures/policy-runtime/policy.json');

const fixtureDir = path.join(__dirname, 'fixtures', 'model-gateway');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

function tempWork(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `awe-local-${name}-`));
  fs.mkdirSync(path.join(dir, '.worklogs', name), { recursive: true });
  return { root: dir, workDir: path.join(dir, '.worklogs', name) };
}

function seed(workDir) {
  const { commitState } = require('../scripts/lib/shared/journal.cjs');
  commitState(workDir, {
    work_id: path.basename(workDir),
    current_state: 'implementation',
    updated_at: '2026-11-06T00:00:00.000Z',
    history: [],
    pipeline: { track: 'rigorous' },
  }, { type: 'init', at: '2026-11-06T00:00:00.000Z' });
}

describe('AE-019b local adapters', () => {
  it('both adapters pass conformance using only transport spies', async () => {
    const ollama = createOllamaAdapter({
      capabilities: {
        'local-model': {
          tools: true, json_schema: true, vision: false, context_tokens: 4096, streaming: false,
        },
      },
    });
    const llama = createLlamaCppAdapter({
      capabilities: {
        'local-model': {
          tools: true, json_schema: true, vision: false, context_tokens: 4096, streaming: false,
        },
      },
    });
    const transport = async ({ provider }) => ({
      body: provider === 'ollama' ? readFixture('ollama-ok.json') : readFixture('openai-ok.json'),
    });
    for (const adapter of [ollama, llama]) {
      const result = await runConformanceSuite(adapter, { model: 'local-model', transport });
      assert.equal(result.ok, true, result.failures.join('; '));
    }
  });

  it('uses native Ollama and OpenAI-compatible llama.cpp paths and reports local zero cost', async () => {
    for (const [provider, adapter, expectedPath, fixture] of [
      ['ollama', createOllamaAdapter(), '/api/chat', 'ollama-ok.json'],
      ['llama.cpp', createLlamaCppAdapter(), '/v1/chat/completions', 'openai-ok.json'],
    ]) {
      const { root, workDir } = tempWork(provider);
      seed(workDir);
      let seen;
      const baseUrl = provider === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:8080';
      const gateway = createModelGateway({
        config: {
          provider,
          models: { balanced: 'local-model' },
          base_url: baseUrl,
          timeout_ms: 1000,
          max_retries: 0,
        },
        adapters: { [provider]: adapter },
        workDir,
        transport: async (request) => {
          seen = request;
          return { body: readFixture(fixture) };
        },
      });
      const response = await gateway.route({
        tier: 'balanced',
        messages: [{ role: 'user', content: 'hello' }],
        idempotency_key: `${provider}-1`,
      });
      assert.match(seen.url, new RegExp(`${expectedPath.replace('/', '\\/')}$`));
      assert.equal(seen.method, 'POST');
      assert.equal(response.usage.cost_source, 'local');
      assert.equal(response.usage.usd, 0);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('PDP denies non-loopback local base URLs before transport', async () => {
    const { root, workDir } = tempWork('deny');
    seed(workDir);
    let calls = 0;
    const gateway = createModelGateway({
      config: {
        provider: 'ollama',
        models: { balanced: 'local-model' },
        base_url: 'http://192.0.2.10:11434',
        timeout_ms: 1000,
        max_retries: 0,
      },
      adapters: { ollama: createOllamaAdapter({ baseUrl: 'http://192.0.2.10:11434' }) },
      policy,
      policyEvaluator: evaluate,
      workDir,
      transport: async () => {
        calls += 1;
        return { body: readFixture('ollama-ok.json') };
      },
    });
    await assert.rejects(
      () => gateway.route({
        tier: 'balanced',
        messages: [{ role: 'user', content: 'hello' }],
        idempotency_key: 'non-loopback-1',
      }),
      (error) => error.code === 'POLICY_DENIED'
    );
    assert.equal(calls, 0);
    const direct = evaluate({
      policy,
      provider: 'ollama',
      cost_source: 'local',
      flags: { non_loopback_base_url: true },
    });
    assert.equal(direct.decision, 'deny');
    assert.equal(direct.rule_id, 'provider.non_loopback');
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('F-M2-09: ADR-008 ignores AGENTIC_SWE_*_HOST env overrides', async () => {
    const prevOllama = process.env.AGENTIC_SWE_OLLAMA_HOST;
    const prevLlama = process.env.AGENTIC_SWE_LLAMA_CPP_HOST;
    process.env.AGENTIC_SWE_OLLAMA_HOST = 'http://192.0.2.55:11434';
    process.env.AGENTIC_SWE_LLAMA_CPP_HOST = 'http://192.0.2.55:8080';
    try {
      for (const [provider, adapter, pathSuffix] of [
        ['ollama', createOllamaAdapter(), '/api/chat'],
        ['llama.cpp', createLlamaCppAdapter(), '/v1/chat/completions'],
      ]) {
        let seen;
        const r = await adapter.complete({
          model: 'local-model',
          messages: [{ role: 'user', content: 'ping' }],
          transport: async (req) => {
            seen = req;
            return {
              body: provider === 'ollama'
                ? readFixture('ollama-ok.json')
                : readFixture('openai-ok.json'),
            };
          },
        });
        assert.ok(r);
        assert.match(seen.url, /^http:\/\/127\.0\.0\.1:/);
        assert.match(seen.url, new RegExp(`${pathSuffix.replace('/', '\\/')}$`));
        assert.doesNotMatch(seen.url, /192\.0\.2\.55/);
      }
    } finally {
      if (prevOllama === undefined) delete process.env.AGENTIC_SWE_OLLAMA_HOST;
      else process.env.AGENTIC_SWE_OLLAMA_HOST = prevOllama;
      if (prevLlama === undefined) delete process.env.AGENTIC_SWE_LLAMA_CPP_HOST;
      else process.env.AGENTIC_SWE_LLAMA_CPP_HOST = prevLlama;
    }
  });

  it('F-M2-09: PDP evaluates before every gateway.route (paid + local)', async () => {
    const { root, workDir } = tempWork('pdp-every');
    seed(workDir);
    let pdpCalls = 0;
    let transportCalls = 0;
    const gateway = createModelGateway({
      config: {
        provider: 'ollama',
        models: { balanced: 'local-model' },
        base_url: 'http://127.0.0.1:11434',
        timeout_ms: 1000,
        max_retries: 0,
      },
      adapters: { ollama: createOllamaAdapter() },
      policy,
      policyEvaluator: (input) => {
        pdpCalls += 1;
        return evaluate(input);
      },
      workDir,
      transport: async () => {
        transportCalls += 1;
        return { body: readFixture('ollama-ok.json') };
      },
    });
    await gateway.route({
      tier: 'balanced',
      messages: [{ role: 'user', content: 'hello' }],
      idempotency_key: 'pdp-every-1',
    });
    assert.ok(pdpCalls >= 1, 'PDP must run before route I/O');
    assert.equal(transportCalls, 1);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('F-M2-09: optional live smoke when Ollama or llama.cpp is reachable', async (t) => {
    async function probe(url) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 1500);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        return res.ok;
      } catch {
        return false;
      }
    }
    const ollamaUp = await probe('http://127.0.0.1:11434/api/tags');
    const llamaUp = await probe('http://127.0.0.1:8080/v1/models');
    if (!ollamaUp && !llamaUp) {
      t.skip('neither Ollama nor llama.cpp is reachable on loopback');
      return;
    }
    if (ollamaUp) {
      const adapter = createOllamaAdapter({ baseUrl: 'http://127.0.0.1:11434' });
      const models = await fetch('http://127.0.0.1:11434/api/tags').then((r) => r.json());
      const model = (models.models && models.models[0] && models.models[0].name) || 'llama3.2';
      const response = await adapter.complete({
        model,
        messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
      });
      assert.equal(response.provider, 'ollama');
      assert.ok(response.content == null || typeof response.content === 'string');
    }
    if (llamaUp) {
      const adapter = createLlamaCppAdapter({ baseUrl: 'http://127.0.0.1:8080' });
      const response = await adapter.complete({
        model: 'local-model',
        messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
      });
      assert.equal(response.provider, 'llama.cpp');
    }
  });
});
