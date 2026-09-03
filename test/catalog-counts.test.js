'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { computeCatalogCounts, renderInline, renderTable } = require('../scripts/lib/catalog/counts.cjs');
const { rewriteOne, parseArgs } = require('../scripts/render-catalog-counts.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const SUBAGENTS_ROOT = path.join(REPO_ROOT, 'agents', 'subagents');
const DEFAULT_TARGETS = ['README.md', 'references/deferred/hypervisor-deferred.md', 'AGENTS.md', 'commands/subagent.md'];

test('computeCatalogCounts matches the actual filesystem', () => {
  const counts = computeCatalogCounts(SUBAGENTS_ROOT);
  const expected = fs.readdirSync(SUBAGENTS_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'custom')
    .reduce((sum, e) => sum + fs.readdirSync(path.join(SUBAGENTS_ROOT, e.name)).filter((f) => f.endsWith('.md')).length, 0);
  assert.equal(counts.total, expected, `total mismatch: expected ${expected}, got ${counts.total}`);
  assert.ok(counts.categories.length >= 10, 'at least 10 categories');
});

test('renderInline mentions every non-empty category', () => {
  const counts = computeCatalogCounts(SUBAGENTS_ROOT);
  const inline = renderInline(counts);
  for (const c of counts.categories) {
    assert.match(inline, new RegExp(c.label.replace(/[&]/g, '&')), `inline missing ${c.label}`);
  }
});

test('renderTable produces one row per category plus header', () => {
  const counts = computeCatalogCounts(SUBAGENTS_ROOT);
  const table = renderTable(counts);
  const dataRows = table.split('\n').filter((l) => l.startsWith('|') && !l.includes('---') && !l.match(/^\| Category/));
  assert.equal(dataRows.length, counts.categories.length);
});

test('all marker-bearing default targets are in sync (no drift)', () => {
  const counts = computeCatalogCounts(SUBAGENTS_ROOT);
  const drifted = [];
  for (const rel of DEFAULT_TARGETS) {
    const abs = path.resolve(REPO_ROOT, rel);
    const result = rewriteOne(abs, counts);
    if (result.status === 'changed') drifted.push(rel);
    if (result.status === 'missing' || result.status === 'no-marker') {
      drifted.push(`${rel} (${result.status})`);
    }
  }
  assert.deepEqual(drifted, [], `drift detected — run: npm run catalog:counts`);
});

test('parseArgs handles --check and --target', () => {
  const a = parseArgs(['node', 'script', '--check']);
  assert.equal(a.check, true);
  const b = parseArgs(['node', 'script', '--target', 'foo.md']);
  assert.deepEqual(b.targets, ['foo.md']);
});
