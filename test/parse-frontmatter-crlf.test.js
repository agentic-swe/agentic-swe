'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { extractFrontmatter } = require('../scripts/lib/catalog/parse-frontmatter.cjs');

describe('extractFrontmatter line endings', () => {
  it('parses LF frontmatter', () => {
    const r = extractFrontmatter('---\nname: x\n---\n\nbody\n');
    assert.ok(r);
    assert.match(r.block, /name: x/);
    assert.match(r.body, /body/);
  });

  it('parses CRLF frontmatter', () => {
    const r = extractFrontmatter('---\r\nname: x\r\n---\r\n\r\nbody\r\n');
    assert.ok(r);
    assert.match(r.block, /name: x/);
    assert.match(r.body, /body/);
  });
});
