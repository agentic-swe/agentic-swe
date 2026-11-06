'use strict';

const { createModelGateway, validateAgainstSchema } = require('./gateway.cjs');
const { runConformanceSuite } = require('./conformance.cjs');
const {
  GatewayError,
  isRetryableStatus,
  errorFromStatus,
  asGatewayError,
  normalizeToolCalls,
} = require('./types.cjs');
const { resolveCost, PRICE_TABLE, priceTableKeys } = require('./cost.cjs');
const fixture = require('./adapters/fixture.cjs');
const anthropicFixture = require('./adapters/anthropic-fixture.cjs');
const broken = require('./adapters/broken.cjs');
const ollama = require('./adapters/ollama.cjs');
const llamacpp = require('./adapters/llamacpp.cjs');

module.exports = {
  createModelGateway,
  validateAgainstSchema,
  runConformanceSuite,
  GatewayError,
  isRetryableStatus,
  errorFromStatus,
  asGatewayError,
  normalizeToolCalls,
  resolveCost,
  PRICE_TABLE,
  priceTableKeys,
  adapters: {
    fixture,
    'anthropic-fixture': anthropicFixture,
    ollama,
    'llama.cpp': llamacpp,
    llamacpp,
    broken,
  },
  createFixtureAdapter: fixture.createFixtureAdapter,
  createAnthropicFixtureAdapter: anthropicFixture.createAnthropicFixtureAdapter,
  createOllamaAdapter: ollama.createOllamaAdapter,
  createLlamaCppAdapter: llamacpp.createLlamaCppAdapter,
};
