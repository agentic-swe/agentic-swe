'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('F-M2-10 E7 npm registry pin', () => {
  it('repo .npmrc pins registry.npmjs.org', () => {
    const npmrc = fs.readFileSync(path.join(__dirname, '..', '.npmrc'), 'utf8');
    assert.match(npmrc, /registry\s*=\s*https:\/\/registry\.npmjs\.org\/?/);
  });

  it('PUBLISHING.md documents E7 override for corporate ~/.npmrc', () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'PUBLISHING.md'), 'utf8');
    assert.match(doc, /Local install \/ registry \(E7\)/);
    assert.match(doc, /npm_config_registry=https:\/\/registry\.npmjs\.org\//);
    assert.match(doc, /unpm/i);
  });
});
