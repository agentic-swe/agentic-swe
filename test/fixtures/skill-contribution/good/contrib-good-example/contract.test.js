'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('contrib-good-example contract: SKILL.md and manifest present', () => {
  const root = __dirname;
  assert.ok(fs.existsSync(path.join(root, 'SKILL.md')));
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(m.name, 'contrib-good-example');
  assert.match(m.digest, /^[a-f0-9]{64}$/);
});
