'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
test('intentionally fails', () => {
  assert.equal(1, 2);
});
