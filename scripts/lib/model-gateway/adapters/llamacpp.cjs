'use strict';

const { GatewayError } = require('../types.cjs');
const {
  assertLoopbackBaseUrl,
  joinUrl,
  requestJson,
  normalizeOpenAiBody,
  capabilities,
} = require('./local.cjs');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';
const DEFAULT_CAPS = {
  tools: true,
  json_schema: true,
  vision: false,
  context_tokens: 32768,
  streaming: false,
};

function createLlamaCppAdapter(opts = {}) {
  const baseUrl = opts.baseUrl || process.env.AGENTIC_SWE_LLAMA_CPP_HOST || DEFAULT_BASE_URL;
  const capabilityOverrides = opts.capabilities || {};
  return {
    id: 'llama.cpp',
    discoverCapabilities(model) {
      return capabilities(capabilityOverrides, DEFAULT_CAPS, model);
    },
    async complete(req) {
      if (req.signal?.aborted) {
        throw new GatewayError('TIMEOUT', 'aborted before llama.cpp request', { retryable: false });
      }
      const base = assertLoopbackBaseUrl(req.base_url || baseUrl, 'llama.cpp');
      const body = {
        model: req.model,
        messages: req.messages,
        stream: false,
      };
      if (req.tools?.length) body.tools = req.tools;
      if (req.response_format) body.response_format = req.response_format;
      const response = await requestJson({
        transport: req.transport,
        url: joinUrl(base, '/v1/chat/completions'),
        provider: 'llama.cpp',
        model: req.model,
        body,
        signal: req.signal,
      });
      return normalizeOpenAiBody(response, req.model, 'llama.cpp');
    },
  };
}

const adapter = createLlamaCppAdapter();
module.exports = {
  id: adapter.id,
  discoverCapabilities: adapter.discoverCapabilities.bind(adapter),
  complete: adapter.complete.bind(adapter),
  createLlamaCppAdapter,
  DEFAULT_BASE_URL,
};
