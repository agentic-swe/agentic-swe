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
    broken,
  },
  createFixtureAdapter: fixture.createFixtureAdapter,
  createAnthropicFixtureAdapter: anthropicFixture.createAnthropicFixtureAdapter,
};
