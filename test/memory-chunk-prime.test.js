'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { runMemoryIndex } = require('../scripts/lib/memory/memory-pipeline.cjs');
const { buildPrimeMarkdown, extractSearchTokens } = require('../scripts/lib/memory/memory-prime.cjs');
const { queryChunkCountDb } = require('../scripts/lib/memory/graph-query.cjs');
const { openOrCreateDatabase, closeDatabase } = require('../scripts/lib/memory/graph-store.cjs');
const { sqlitePathForProject, loadMergedMemoryConfig } = require('../scripts/lib/memory/config.cjs');

describe('chunk search tokens', () => {
  it('extractSearchTokens splits words', () => {
    const t = extractSearchTokens('hello world');
    assert.ok(t.includes('hello'));
    assert.ok(t.includes('world'));
  });
});

describe('chunk ingest + prime', () => {
  let tmp;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-chunk-'));
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'cfix', private: true }),
      'utf8'
    );
    fs.mkdirSync(path.join(tmp, 'docs'));
    fs.writeFileSync(
      path.join(tmp, 'docs', 'alpha.md'),
      '# Alpha\n\nUniqueMarkerXYZ one two.\n\n## Sub\n\nMore text.\n',
      'utf8'
    );
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('indexes markdown chunks and finds tokens via prime', async () => {
    const r = await runMemoryIndex({ projectRoot: tmp, pluginRoot: root });
    assert.ok(r.stats.chunks >= 1, 'expected chunks');

    const merged = loadMergedMemoryConfig(root, tmp);
    const sqlitePath = sqlitePathForProject(merged, tmp);
    const { db } = await openOrCreateDatabase(sqlitePath);
    try {
      assert.ok(queryChunkCountDb(db) >= 1);
    } finally {
      closeDatabase(db);
    }

    const md = await buildPrimeMarkdown({
      projectRoot: tmp,
      pluginRoot: root,
      query: 'UniqueMarkerXYZ',
    });
    assert.ok(md.includes('UniqueMarkerXYZ'), md);
    assert.ok(md.includes('Chunk search') || md.includes('chunk'), md);
  });
});
