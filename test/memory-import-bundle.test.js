'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { runMemoryImport } = require('../scripts/lib/memory/memory-import-apply.cjs');
const { openOrCreateDatabase, closeDatabase } = require('../scripts/lib/memory/graph-store.cjs');

describe('memory-import bundle', () => {
  let tmp;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-imp-'));
    fs.mkdirSync(path.join(tmp, '.agentic-swe'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'x', private: true }), 'utf8');
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('merges nodes and edges with --force when adapter disabled', async () => {
    const bundle = {
      schema_version: 1,
      nodes: [
        { id: 'custom:node-a', kind: 'custom', label: 'A' },
        { id: 'custom:node-b', kind: 'custom', label: 'B' },
      ],
      edges: [{ src_id: 'custom:node-a', dst_id: 'custom:node-b', kind: 'relates_to' }],
      provenance: { source: 'test-fixture', imported_at: new Date().toISOString() },
    };

    const r = await runMemoryImport({ projectRoot: tmp, pluginRoot: root, bundle, force: true });
    assert.strictEqual(r.ok, true, r.message || '');
    const sqlitePath = r.sqlitePath;
    const { db } = await openOrCreateDatabase(sqlitePath);
    try {
      const n = db.exec("SELECT COUNT(*) AS c FROM nodes WHERE id LIKE 'custom:%'");
      assert.ok(n[0].values[0][0] >= 2);
      const e = db.exec('SELECT COUNT(*) AS c FROM edges WHERE kind = "relates_to"');
      assert.ok(Number(e[0].values[0][0]) >= 1);
    } finally {
      closeDatabase(db);
    }
  });
});
