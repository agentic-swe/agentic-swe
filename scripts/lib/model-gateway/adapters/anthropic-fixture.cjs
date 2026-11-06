'use strict';

const { GatewayError, errorFromStatus, normalizeToolCalls } = require('../types.cjs');
const { redactSecrets } = require('../../shared/redact.cjs');

function throwStatus(status, message) {
  throw errorFromStatus(status, redactSecrets(String(message || '')).redacted);
}

/**
 * Hand-written Anthropic Messages shape coverage (ADR-008). No live calls.
 * Default model is on the gateway price table so cost_source becomes price_table.
 */
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';

const DEFAULT_CAPS = {
  tools: true,
  json_schema: true,
  vision: true,
  context_tokens: 200000,
  streaming: false,
};

function createAnthropicFixtureAdapter(opts = {}) {
  const capabilityOverrides = opts.capabilities || {};
  const canned = opts.cannedResponses || null;

  return {
    id: 'anthropic-fixture',

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

    async complete(req) {
      if (req.signal?.aborted) {
        throw new GatewayError('TIMEOUT', 'aborted before anthropic-fixture complete', {
          retryable: false,
        });
      }

      if (req.transport) {
        const result = await req.transport({
          provider: 'anthropic-fixture',
          model: req.model || DEFAULT_MODEL,
          messages: req.messages,
          tools: req.tools,
          response_format: req.response_format,
          signal: req.signal,
          scenario: req.scenario,
        });
        if (req.signal?.aborted) {
          throw new GatewayError('TIMEOUT', 'aborted during anthropic-fixture transport', {
            retryable: false,
          });
        }
        if (result?.error || (result?.status && result.status >= 400)) {
          throwStatus(
            result.status || result.error?.status,
            result.error?.message || `HTTP ${result.status}`
          );
        }
        return normalizeAnthropicMessage(result.body || result, req.model || DEFAULT_MODEL);
      }

      if (canned) {
        const key = req.scenario || req.model || 'default';
        const entry = typeof canned === 'function' ? canned(req) : canned[key] || canned.default;
        if (entry?.error) {
          throwStatus(entry.error.status, entry.error.message || 'anthropic fixture error');
        }
        return normalizeAnthropicMessage(entry || defaultAnthropicBody(req.model), req.model);
      }

      return normalizeAnthropicMessage(defaultAnthropicBody(req.model), req.model);
    },
  };
}

function defaultAnthropicBody(model) {
  return {
    id: 'msg_fixture_01',
    type: 'message',
    role: 'assistant',
    model: model || DEFAULT_MODEL,
    content: [{ type: 'text', text: '{"ok":true}' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 20,
      output_tokens: 8,
      cache_read_input_tokens: 0,
    },
  };
}

/**
 * Normalize Anthropic Messages API response into gateway ModelResponse fields.
 * @param {object} body
 * @param {string} model
 */
function normalizeAnthropicMessage(body, model) {
  if (!body || typeof body !== 'object') {
    throw new GatewayError('PROVIDER_ERROR', 'empty anthropic fixture body', { retryable: false });
  }

  const blocks = Array.isArray(body.content) ? body.content : [];
  const textParts = [];
  const rawTools = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && block.text != null) textParts.push(String(block.text));
    if (block.type === 'tool_use') {
      rawTools.push({
        id: block.id,
        name: block.name,
        arguments: block.input,
      });
    }
  }

  const tool_calls = normalizeToolCalls(rawTools);
  let finish_reason = 'stop';
  if (body.stop_reason === 'max_tokens') finish_reason = 'length';
  else if (body.stop_reason === 'tool_use' || tool_calls.length) finish_reason = 'tool_calls';
  else if (body.stop_reason === 'error') finish_reason = 'error';

  const u = body.usage || {};
  const hasUsage = body.usage != null;

  return {
    content: textParts.length ? textParts.join('') : null,
    tool_calls,
    finish_reason,
    usage: {
      input: hasUsage ? (u.input_tokens ?? null) : null,
      output: hasUsage ? (u.output_tokens ?? null) : null,
      cache_read: hasUsage ? (u.cache_read_input_tokens ?? null) : null,
      usage_source: hasUsage ? 'provider' : 'absent',
    },
    model: body.model || model || DEFAULT_MODEL,
    provider: 'anthropic-fixture',
    raw: body,
  };
}

const anthropicFixtureAdapter = createAnthropicFixtureAdapter();

module.exports = {
  id: anthropicFixtureAdapter.id,
  discoverCapabilities: anthropicFixtureAdapter.discoverCapabilities.bind(anthropicFixtureAdapter),
  complete: anthropicFixtureAdapter.complete.bind(anthropicFixtureAdapter),
  createAnthropicFixtureAdapter,
  normalizeAnthropicMessage,
  DEFAULT_MODEL,
};
