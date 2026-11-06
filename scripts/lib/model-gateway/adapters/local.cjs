'use strict';

const { GatewayError, errorFromStatus, normalizeToolCalls } = require('../types.cjs');
const { redactSecrets } = require('../../shared/redact.cjs');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function isLoopbackBaseUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function assertLoopbackBaseUrl(value, provider) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new GatewayError('CONFIG_INVALID', `${provider} base_url must be a valid URL`, {
      retryable: false,
    });
  }
  if (!['http:', 'https:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new GatewayError('POLICY_DENIED', `${provider} base_url must target loopback`, {
      retryable: false,
      details: { code: 'PROVIDER_DENIED', rule_id: 'provider.non_loopback' },
    });
  }
  return url;
}

function joinUrl(base, suffix) {
  const url = new URL(base.toString());
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
  return url.toString();
}

async function requestJson({ transport, url, provider, model, body, signal }) {
  const request = {
    provider,
    model,
    url,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal,
  };
  const result = transport
    ? await transport(request)
    : await defaultTransport(request);
  if (!result || typeof result !== 'object') {
    throw new GatewayError('PROVIDER_ERROR', 'empty local provider response', { retryable: true });
  }
  if (result.error || (result.status != null && Number(result.status) >= 400)) {
    const status = result.error?.status ?? result.status;
    throw errorFromStatus(
      status,
      redactSecrets(result.error?.message || `HTTP ${status}`).redacted,
      { details: result.error }
    );
  }
  return result.body != null ? result.body : result;
}

async function defaultTransport({ url, headers, body, signal }) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  let parsed;
  try {
    parsed = await response.json();
  } catch {
    parsed = { error: { message: 'local provider returned a non-JSON response' } };
  }
  return { status: response.status, body: parsed };
}

function normalizeOllamaBody(body, model) {
  if (!body || typeof body !== 'object' || !body.message) {
    throw new GatewayError('PROVIDER_ERROR', 'unrecognized Ollama response shape', {
      retryable: false,
    });
  }
  const message = body.message;
  const tool_calls = normalizeToolCalls(
    Array.isArray(message.tool_calls)
      ? message.tool_calls.map((call) => ({
          id: call.id,
          name: call.function?.name || call.name,
          arguments: call.function?.arguments ?? call.arguments,
        }))
      : []
  );
  const hasUsage = body.prompt_eval_count != null || body.eval_count != null;
  return {
    content: message.content != null ? String(message.content) : null,
    tool_calls,
    finish_reason: tool_calls.length ? 'tool_calls' : 'stop',
    usage: {
      input: hasUsage ? (body.prompt_eval_count ?? null) : null,
      output: hasUsage ? (body.eval_count ?? null) : null,
      usage_source: hasUsage ? 'provider' : 'absent',
    },
    model: body.model || model,
    provider: 'ollama',
    raw: body,
  };
}

function normalizeOpenAiBody(body, model, provider) {
  const choice = body && body.choices && body.choices[0];
  if (!choice) {
    throw new GatewayError('PROVIDER_ERROR', 'unrecognized OpenAI-compatible response shape', {
      retryable: false,
    });
  }
  const message = choice.message || {};
  const tool_calls = normalizeToolCalls(message.tool_calls || []);
  const usage = body.usage || {};
  const hasUsage = body.usage != null;
  return {
    content: message.content != null ? String(message.content) : null,
    tool_calls,
    finish_reason: tool_calls.length ? 'tool_calls' : choice.finish_reason || 'stop',
    usage: {
      input: hasUsage ? (usage.prompt_tokens ?? null) : null,
      output: hasUsage ? (usage.completion_tokens ?? null) : null,
      usage_source: hasUsage ? 'provider' : 'absent',
    },
    model: body.model || model,
    provider,
    raw: body,
  };
}

function capabilities(overrides, defaults, model) {
  const value = overrides && overrides[model];
  return {
    ...defaults,
    ...(value && typeof value === 'object' ? value : {}),
    context_tokens: Number(value?.context_tokens || defaults.context_tokens),
    tools: Boolean(value?.tools ?? defaults.tools),
    json_schema: Boolean(value?.json_schema ?? defaults.json_schema),
    vision: Boolean(value?.vision ?? defaults.vision),
    streaming: Boolean(value?.streaming ?? defaults.streaming),
  };
}

module.exports = {
  LOOPBACK_HOSTS,
  isLoopbackBaseUrl,
  assertLoopbackBaseUrl,
  joinUrl,
  requestJson,
  normalizeOllamaBody,
  normalizeOpenAiBody,
  capabilities,
};
