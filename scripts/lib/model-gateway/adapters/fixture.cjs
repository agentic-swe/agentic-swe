'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { GatewayError, errorFromStatus, normalizeToolCalls } = require('../types.cjs');
const { redactSecrets } = require('../../shared/redact.cjs');

function throwStatus(status, message, extra) {
  const err = errorFromStatus(status, redactSecrets(String(message || '')).redacted, extra);
  throw err;
}

const DEFAULT_CAPS = {
  tools: true,
  json_schema: true,
  vision: false,
  context_tokens: 8192,
  streaming: false,
};

/**
 * Recorded-fixture adapter (Ollama-ish + OpenAI-compatible shapes).
 * Zero network unless an injected transport is provided.
 */
function createFixtureAdapter(opts = {}) {
  const capabilityOverrides = opts.capabilities || {};
  const fixtureDir = opts.fixtureDir || null;
  const canned = opts.cannedResponses || null;

  const adapter = {
    id: 'fixture',

    /**
     * @param {string} model
     * @returns {import('../types.cjs').Capabilities}
     */
    discoverCapabilities(model) {
      const over = capabilityOverrides[model];
      if (over && typeof over === 'object') {
        return {
          tools: Boolean(over.tools),
          json_schema: Boolean(over.json_schema),
          vision: Boolean(over.vision),
          context_tokens: Number(over.context_tokens) || DEFAULT_CAPS.context_tokens,
          streaming: Boolean(over.streaming),
        };
      }
      return { ...DEFAULT_CAPS };
    },

    /**
     * @param {{
     *   model: string,
     *   messages: object[],
     *   tools?: object[],
     *   response_format?: object,
     *   signal?: AbortSignal,
     *   transport?: Function,
     *   scenario?: string,
     * }} req
     */
    async complete(req) {
      if (req.signal?.aborted) {
        const err = new GatewayError('TIMEOUT', 'aborted before complete', { retryable: false });
        throw err;
      }

      const onAbort = () => {
        /* checked below */
      };
      if (req.signal) req.signal.addEventListener('abort', onAbort, { once: true });

      try {
        if (req.transport) {
          const result = await req.transport({
            provider: 'fixture',
            model: req.model,
            messages: req.messages,
            tools: req.tools,
            response_format: req.response_format,
            signal: req.signal,
            scenario: req.scenario,
          });
          if (req.signal?.aborted) {
            throw new GatewayError('TIMEOUT', 'aborted during transport', { retryable: false });
          }
          return normalizeTransportResult(result, req.model);
        }

        if (canned) {
          const key = req.scenario || req.model || 'default';
          const entry = typeof canned === 'function' ? canned(req) : canned[key] || canned.default;
          if (!entry) {
            throw new GatewayError('PROVIDER_ERROR', `no canned response for ${key}`, {
              retryable: false,
            });
          }
          if (entry.error) {
            const status = entry.error.status;
            throwStatus(status, entry.error.message || `fixture error ${status}`, {
              details: entry.error,
            });
          }
          if (req.signal?.aborted) {
            throw new GatewayError('TIMEOUT', 'aborted before fixture return', { retryable: false });
          }
          return normalizeFixtureBody(entry, req.model);
        }

        if (fixtureDir) {
          const file = path.join(fixtureDir, `${req.scenario || req.model || 'default'}.json`);
          if (!fs.existsSync(file)) {
            throw new GatewayError('PROVIDER_ERROR', `fixture file missing: ${path.basename(file)}`, {
              retryable: false,
            });
          }
          const body = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (req.signal?.aborted) {
            throw new GatewayError('TIMEOUT', 'aborted while reading fixture', { retryable: false });
          }
          return normalizeFixtureBody(body, req.model);
        }

        // Default local success (OpenAI-compatible chat.completion shape)
        return normalizeFixtureBody(
          {
            id: 'fixture-local',
            object: 'chat.completion',
            model: req.model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: '{"ok":true}' },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          },
          req.model
        );
      } finally {
        if (req.signal) req.signal.removeEventListener('abort', onAbort);
      }
    },
  };

  return adapter;
}

function normalizeTransportResult(result, model) {
  if (!result || typeof result !== 'object') {
    throw new GatewayError('PROVIDER_ERROR', 'empty transport result', { retryable: true });
  }
  if (result.error) {
    const status = result.error.status ?? result.status;
    throwStatus(status, result.error.message || String(result.error), {
      details: result.error,
    });
  }
  if (result.status && result.status >= 400) {
    throwStatus(result.status, result.body?.error?.message || `HTTP ${result.status}`);
  }
  const body = result.body != null ? result.body : result;
  return normalizeFixtureBody(body, model);
}

/**
 * Accept OpenAI chat.completion or Ollama /api/chat shapes.
 */
function normalizeFixtureBody(body, model) {
  // Ollama native
  if (body.message && (body.done === true || body.done === false || body.model)) {
    const msg = body.message;
    let toolCalls = [];
    if (Array.isArray(msg.tool_calls)) {
      toolCalls = normalizeToolCalls(
        msg.tool_calls.map((tc, i) => ({
          id: tc.id,
          name: tc.function?.name || tc.name,
          arguments: tc.function?.arguments ?? tc.arguments,
        }))
      );
    }
    const usageRaw = body.prompt_eval_count != null || body.eval_count != null;
    return {
      content: msg.content != null ? String(msg.content) : null,
      tool_calls: toolCalls,
      finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
      usage: {
        input: usageRaw ? (body.prompt_eval_count ?? null) : null,
        output: usageRaw ? (body.eval_count ?? null) : null,
        usage_source: usageRaw ? 'provider' : 'absent',
      },
      model: body.model || model,
      provider: 'fixture',
      raw: body,
    };
  }

  // OpenAI-compatible
  const choice = body.choices && body.choices[0];
  if (choice) {
    const msg = choice.message || {};
    const toolCalls = normalizeToolCalls(msg.tool_calls || []);
    const u = body.usage || {};
    const hasUsage = body.usage != null;
    let finish = choice.finish_reason || 'stop';
    if (finish === 'tool_calls' || toolCalls.length) finish = toolCalls.length ? 'tool_calls' : finish;
    if (finish !== 'stop' && finish !== 'length' && finish !== 'tool_calls' && finish !== 'error') {
      finish = 'stop';
    }
    return {
      content: msg.content != null ? String(msg.content) : null,
      tool_calls: toolCalls,
      finish_reason: finish,
      usage: {
        input: hasUsage ? (u.prompt_tokens ?? null) : null,
        output: hasUsage ? (u.completion_tokens ?? null) : null,
        usage_source: hasUsage ? 'provider' : 'absent',
      },
      model: body.model || model,
      provider: 'fixture',
      raw: body,
    };
  }

  if (body.content != null || body.tool_calls) {
    return {
      content: body.content != null ? String(body.content) : null,
      tool_calls: normalizeToolCalls(body.tool_calls || []),
      finish_reason: body.finish_reason || 'stop',
      usage: {
        input: body.usage?.input ?? null,
        output: body.usage?.output ?? null,
        usage_source: body.usage ? 'provider' : 'absent',
      },
      model: body.model || model,
      provider: 'fixture',
      raw: body,
    };
  }

  throw new GatewayError('PROVIDER_ERROR', 'unrecognized fixture response shape', { retryable: false });
}

const fixtureAdapter = createFixtureAdapter();

module.exports = {
  id: fixtureAdapter.id,
  discoverCapabilities: fixtureAdapter.discoverCapabilities.bind(fixtureAdapter),
  complete: fixtureAdapter.complete.bind(fixtureAdapter),
  createFixtureAdapter,
  normalizeFixtureBody,
};
