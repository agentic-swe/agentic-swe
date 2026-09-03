'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildRepoMap } = require('../scripts/lib/repo-map/build.cjs');
const { resolvePrimeQuery } = require('../scripts/lib/memory/resolve-prime-query.cjs');

describe('repo-map: buildRepoMap', () => {
  const root = path.join(__dirname, '..');

  it('indexes scripts/work-engine.cjs with symbols', () => {
    const map = buildRepoMap(root);
    const ent = map.files.find((f) => f.file === 'scripts/work-engine.cjs');
    assert.ok(ent, 'work-engine.cjs should be indexed');
    assert.ok(ent.symbols.length > 0, 'should extract symbols');
  });

  it('--symbol style lookup finds main', () => {
    const map = buildRepoMap(root);
    const hits = map.symbolIndex.get('main') || [];
    assert.ok(hits.some((f) => f.includes('work-engine.cjs')), 'main should map to work-engine');
  });

  it('tests-for links test files to sources', () => {
    const map = buildRepoMap(root);
    const tests = map.testsFor.get('scripts/lib/repo-map/build.cjs') || [];
    assert.ok(
      tests.some((t) => t.includes('repo-map.test.js')),
      `expected test link, got ${JSON.stringify(tests)}`
    );
  });
});

describe('resolve-prime-query', () => {
  const tmp = path.join(__dirname, '_tmp-prime-query');
  const workId = 'test-work';

  it('prefers explicit query', () => {
    const r = resolvePrimeQuery({ projectRoot: tmp, query: 'fix auth bug' });
    assert.strictEqual(r.query, 'fix auth bug');
    assert.strictEqual(r.source, 'explicit');
  });

  it('derives query from active work item task', () => {
    fs.mkdirSync(path.join(tmp, '.worklogs', workId), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.worklogs', workId, 'state.json'),
      JSON.stringify({ current_state: 'feasibility', task: 'Add retry logic to API client' })
    );
    const r = resolvePrimeQuery({ projectRoot: tmp });
    assert.strictEqual(r.query, 'Add retry logic to API client');
    assert.strictEqual(r.source, 'work-item');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
