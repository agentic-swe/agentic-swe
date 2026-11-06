'use strict';

const { GatewayError } = require('../types.cjs');
const {
  assertLoopbackBaseUrl,
  joinUrl,
  requestJson,
  normalizeOllamaBody,
  capabilities,
} = require('./local.cjs');

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_CAPS = {
  tools: true,
  json_schema: true,
  vision: false,
  context_tokens: 32768,
  streaming: false,
};

function createOllamaAdapter(opts = {}) {
  const baseUrl = opts.baseUrl || process.env.AGENTIC_SWE_OLLAMA_HOST || DEFAULT_BASE_URL;
  const capabilityOverrides = opts.capabilities || {};
  return {
    id: 'ollama',
    discoverCapabilities(model) {
      return capabilities(capabilityOverrides, DEFAULT_CAPS, model);
    },
    async complete(req) {
      if (req.signal?.aborted) {
        throw new GatewayError('TIMEOUT', 'aborted before Ollama request', { retryable: false });
      }
      const base = assertLoopbackBaseUrl(req.base_url || baseUrl, 'Ollama');
      const body = {
        model: req.model,
        messages: req.messages,
        stream: false,
      };
      if (req.tools?.length) body.tools = req.tools;
      if (req.response_format?.json_schema?.schema) {
        body.format = req.response_format.json_schema.schema;
      }
      const response = await requestJson({
        transport: req.transport,
        url: joinUrl(base, '/api/chat'),
        provider: 'ollama',
        model: req.model,
        body,
        signal: req.signal,
      });
      return normalizeOllamaBody(response, req.model);
    },
  };
}

const adapter = createOllamaAdapter();
module.exports = {
  id: adapter.id,
  discoverCapabilities: adapter.discoverCapabilities.bind(adapter),
  complete: adapter.complete.bind(adapter),
  createOllamaAdapter,
  DEFAULT_BASE_URL,
};
