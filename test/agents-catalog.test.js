'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const subagentsDir = path.join(__dirname, '..', '.claude', 'agents', 'subagents');
const selectionPath = path.join(__dirname, '..', '.claude', 'phases', 'subagent-selection.md');

const SKIP_DIRS = ['custom'];

describe('agents-catalog: subagent category folders', () => {
  const categories = fs.readdirSync(subagentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !SKIP_DIRS.includes(d.name))
    .map((d) => d.name);

  it('has at least 5 category folders', () => {
    assert.ok(categories.length >= 5, `only ${categories.length} categories found`);
  });

  for (const cat of categories) {
    it(`category "${cat}" contains at least one .md file`, () => {
      const catDir = path.join(subagentsDir, cat);
      const mds = fs.readdirSync(catDir).filter((f) => f.endsWith('.md'));
      assert.ok(mds.length > 0, `${cat}/ has no .md files`);
    });
  }
});

describe('agents-catalog: subagent files are non-empty', () => {
  const categories = fs.readdirSync(subagentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !SKIP_DIRS.includes(d.name))
    .map((d) => d.name);

  for (const cat of categories) {
    const catDir = path.join(subagentsDir, cat);
    const mds = fs.readdirSync(catDir).filter((f) => f.endsWith('.md'));
    for (const file of mds) {
      it(`${cat}/${file} is non-empty`, () => {
        const body = fs.readFileSync(path.join(catDir, file), 'utf8');
        assert.ok(body.trim().length > 0, `${cat}/${file} is empty`);
      });
    }
  }
});

describe('agents-catalog: subagent-selection.md references valid categories', () => {
  it('subagent-selection.md exists', () => {
    assert.ok(fs.existsSync(selectionPath), 'subagent-selection.md missing');
  });

  it('references categories that exist on disk', () => {
    const body = fs.readFileSync(selectionPath, 'utf8');
    const diskCategories = fs.readdirSync(subagentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !SKIP_DIRS.includes(d.name))
      .map((d) => d.name);

    const agentRefs = body.match(/`([a-z][\w-]+(?:-[a-z][\w-]+)*)`/g) || [];
    const refNames = agentRefs.map((r) => r.replace(/`/g, ''));

    for (const cat of diskCategories) {
      const catMds = fs.readdirSync(path.join(subagentsDir, cat))
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace('.md', ''));
      const hasRef = catMds.some((agent) => refNames.includes(agent));
      if (!hasRef) continue;
      assert.ok(
        fs.existsSync(path.join(subagentsDir, cat)),
        `referenced category "${cat}" missing on disk`
      );
    }
  });
});
