'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { extractImportSpecifiers, fileNodeId, npmNodeId } = require('../scripts/lib/memory/import-extract.cjs');
const { ingestGraphProject } = require('../scripts/lib/memory/graph-ingest.cjs');
const { queryGraphStats } = require('../scripts/lib/memory/graph-query.cjs');

const root = path.join(__dirname, '..');

describe('import extraction', () => {
  it('extracts require and import specifiers', () => {
    const src = `
      import x from 'lodash';
      const a = require('fs');
      require('path');
      export { z } from './other';
    `;
    const s = extractImportSpecifiers(src);
    assert.ok(s.includes('lodash'));
    assert.ok(s.includes('fs'));
    assert.ok(s.includes('path'));
    assert.ok(s.includes('./other'));
  });
});

describe('graph ingest (fixture)', () => {
  let tmp;
  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-graph-'));
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({
        name: 'fixture-pkg',
        dependencies: { lodash: '^4.0.0' },
      }),
      'utf8'
    );
    fs.mkdirSync(path.join(tmp, 'lib'));
    fs.writeFileSync(
      path.join(tmp, 'lib', 'a.js'),
      `const _ = require('lodash');\nconst b = require('./b');\n`,
      'utf8'
    );
    fs.writeFileSync(path.join(tmp, 'lib', 'b.js'), `module.exports = 1;\n`, 'utf8');
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('ingests manifests and import edges into SQLite', async () => {
    const r = await ingestGraphProject({ projectRoot: tmp, pluginRoot: root });
    assert.ok(r.sqlitePath.includes('memory.sqlite'));
    assert.ok(r.stats.nodes >= 5);
    assert.ok(r.stats.edges >= 5);

    const stats = await queryGraphStats(r.sqlitePath);
    assert.ok(stats.kinds.nodes.manifest >= 1);
    assert.ok(stats.kinds.nodes.npm >= 1);
    assert.ok(stats.kinds.edges.depends_on >= 1);
    assert.ok(stats.kinds.edges.imports >= 2);

    assert.strictEqual(fileNodeId('lib/a.js'), 'file:lib/a.js');
    assert.strictEqual(npmNodeId('lodash'), 'npm:lodash');
  });
});
