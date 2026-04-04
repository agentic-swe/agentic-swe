'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const subagentsDir = path.join(__dirname, '..', 'agents', 'subagents');
const selectionPath = path.join(__dirname, '..', 'phases', 'subagent-selection.md');

describe('agents catalog', () => {
  it('subagents directory exists and has categories', () => {
    assert.ok(fs.existsSync(subagentsDir));
    const cats = fs.readdirSync(subagentsDir).filter((n) => fs.statSync(path.join(subagentsDir, n)).isDirectory());
    assert.ok(cats.length >= 5, 'expected multiple subagent categories');
  });

  it('subagent-selection phase exists', () => {
    assert.ok(fs.existsSync(selectionPath));
  });
});
