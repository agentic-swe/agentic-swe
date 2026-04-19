'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { runMemoryIndex } = require('../scripts/lib/memory/memory-pipeline.cjs');
const { buildPrimeMarkdown } = require('../scripts/lib/memory/memory-prime.cjs');

describe('embeddings + semantic prime (test backend)', () => {
  let tmp;
  let prevBack;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-emb-'));
    prevBack = process.env.AGENTIC_SWE_EMBEDDINGS_BACKEND;
    process.env.AGENTIC_SWE_EMBEDDINGS_BACKEND = 'test';

    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'embfix', private: true }),
      'utf8'
    );
    fs.mkdirSync(path.join(tmp, '.agentic-swe'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.agentic-swe', 'memory.json'),
      JSON.stringify(
        {
          embeddings: { enabled: true, provider: 'test' },
          prime: { retrieval_mode: 'auto', max_fts_hits: 8 },
        },
        null,
        2
      ),
      'utf8'
    );
    fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'docs', 'embed.md'),
      '# E\n\nOmegaEmbedPhrase99 unique body for semantic match.\n',
      'utf8'
    );
  });

  after(() => {
    if (prevBack === undefined) delete process.env.AGENTIC_SWE_EMBEDDINGS_BACKEND;
    else process.env.AGENTIC_SWE_EMBEDDINGS_BACKEND = prevBack;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('indexes embeddings and finds chunk via auto→hybrid when embeddings exist', async () => {
    const r = await runMemoryIndex({ projectRoot: tmp, pluginRoot: root });
    assert.ok(r.stats.embedded >= 1, `expected embedded >= 1, got ${r.stats.embedded}`);

    const md = await buildPrimeMarkdown({
      projectRoot: tmp,
      pluginRoot: root,
      query: 'OmegaEmbedPhrase99 unique body for semantic match.',
    });
    assert.ok(md.includes('docs/embed.md'), md);
    assert.ok(md.includes('Chunk search (hybrid)'), md);
  });
});
