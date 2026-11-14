'use strict';

/**
 * M4 audit NB7 — ingest/prime must not require graph-store directly;
 * modules outside scripts/lib/memory/ need an explicit allowlist.
 * Refs ADR-012, ADR-016; provenance writers remain graph-store helpers under the adapter.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createMemoryService,
  writeIngestChunkToDb,
  assertKnownScope,
} = require('../scripts/lib/memory/memory-service.cjs');
const {
  openOrCreateDatabase,
  closeDatabase,
  persistDatabase,
} = require('../scripts/lib/memory/graph-store.cjs');

const pluginRoot = path.resolve(__dirname, '..');

const GRAPH_STORE_REQUIRE_RE =
  /require\s*\(\s*['`][^'`]*graph-store(?:\.cjs)?['`]\s*\)/;

/** Ingest/prime entrypoints that must route through MemoryService (NB7). */
const MUST_NOT_REQUIRE_GRAPH_STORE = new Set([
  'scripts/lib/memory/chunk-ingest.cjs',
  'scripts/lib/memory/session-ingest.cjs',
  'scripts/lib/memory/memory-prime.cjs',
  'scripts/lib/memory/incremental-index.cjs',
]);

/**
 * Outside scripts/lib/memory/ — only these may require graph-store directly.
 * AE-R2: fleet/skills/descent routes migrated to MemoryService.withProjectDb.
 * Every remaining entry needs a one-line justification (enforced below).
 */
const OUTSIDE_MEMORY_ALLOWLIST = new Map([
  [
    'scripts/session-capture.cjs',
    'CLI entry opens project sqlite for typed session capture nodes via upsertNodeRow (not chunk MemoryService writes).',
  ],
  [
    'scripts/seed-memory-corpus.cjs',
    'Bench corpus seeder builds fixture sqlite trees outside the MemoryService seam for offline replay.',
  ],
]);

/** AE-R2 migrated paths — must not require graph-store directly. */
const MIGRATED_TO_MEMORY_SERVICE = [
  'scripts/lib/skills/ingest-project-skills.cjs',
  'scripts/lib/fleet/ingest-fleet-memory.cjs',
  'scripts/lib/skills/skill-router.cjs',
  'scripts/lib/descent/ladder.cjs',
  'scripts/lib/descent/mine-session-procedures.cjs',
];

function walkJsFiles(root, out) {
  let ents;
  try {
    ents = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of ents) {
    const abs = path.join(root, ent.name);
    if (ent.isDirectory()) {
      if (
        ent.name === 'node_modules' ||
        ent.name === '.git' ||
        ent.name === 'dist' ||
        ent.name === 'coverage'
      ) {
        continue;
      }
      walkJsFiles(abs, out);
    } else if (ent.isFile() && (ent.name.endsWith('.cjs') || ent.name.endsWith('.js'))) {
      out.push(abs);
    }
  }
}

describe('NB7 MemoryService layering for ingest/prime', () => {
  it('ingest/prime modules do not require graph-store directly', () => {
    const offenders = [];
    for (const rel of MUST_NOT_REQUIRE_GRAPH_STORE) {
      const abs = path.join(pluginRoot, rel);
      assert.ok(fs.existsSync(abs), `missing ${rel}`);
      const text = fs.readFileSync(abs, 'utf8');
      if (GRAPH_STORE_REQUIRE_RE.test(text)) offenders.push(rel);
    }
    assert.deepEqual(
      offenders,
      [],
      `ingest/prime must use MemoryService, not graph-store require:\n${offenders.join('\n')}`
    );
  });

  it('modules outside scripts/lib/memory/ require graph-store only via allowlist', () => {
    const files = [];
    walkJsFiles(path.join(pluginRoot, 'scripts'), files);
    const offenders = [];
    for (const abs of files) {
      const rel = path.relative(pluginRoot, abs).split(path.sep).join('/');
      if (rel.startsWith('scripts/lib/memory/')) continue;
      if (OUTSIDE_MEMORY_ALLOWLIST.has(rel)) continue;
      const text = fs.readFileSync(abs, 'utf8');
      if (GRAPH_STORE_REQUIRE_RE.test(text)) offenders.push(rel);
    }
    assert.deepEqual(
      offenders,
      [],
      `unexpected graph-store require outside memory/ (add allowlist + justification or route via MemoryService):\n${offenders.join('\n')}`
    );
  });

  it('allowlist entries exist, still require graph-store, and each has a one-line justification', () => {
    assert.equal(OUTSIDE_MEMORY_ALLOWLIST.size, 2, 'AE-R2 should leave only CLI+seed allowlist entries');
    for (const [rel, reason] of OUTSIDE_MEMORY_ALLOWLIST) {
      assert.ok(String(reason || '').trim().length > 10, `justify ${rel}`);
      assert.ok(!String(reason).includes('\n'), `justification for ${rel} must be one line`);
      const abs = path.join(pluginRoot, rel);
      assert.ok(fs.existsSync(abs), `allowlisted missing: ${rel}`);
      const text = fs.readFileSync(abs, 'utf8');
      assert.ok(
        GRAPH_STORE_REQUIRE_RE.test(text),
        `allowlisted ${rel} no longer requires graph-store — remove from allowlist`
      );
    }
  });

  it('AE-R2 migrated fleet/skills/descent modules do not require graph-store', () => {
    const offenders = [];
    for (const rel of MIGRATED_TO_MEMORY_SERVICE) {
      const abs = path.join(pluginRoot, rel);
      assert.ok(fs.existsSync(abs), `missing ${rel}`);
      const text = fs.readFileSync(abs, 'utf8');
      if (GRAPH_STORE_REQUIRE_RE.test(text)) offenders.push(rel);
      assert.ok(
        /createMemoryService|withProjectDb|writeIngestChunkToDb/.test(text),
        `${rel} should route through MemoryService`
      );
    }
    assert.deepEqual(offenders, [], `migrated modules still require graph-store:\n${offenders.join('\n')}`);
  });

  it('writeIngestChunkToDb fails closed on unknown scope', async () => {
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'nb7-scope-'));
    const sqlitePath = path.join(tmp, 'memory.sqlite');
    try {
      const { db } = await openOrCreateDatabase(sqlitePath);
      try {
        assert.throws(
          () =>
            writeIngestChunkToDb(db, {
              chunkId: 'c1',
              path: 'x.md',
              workId: null,
              scope: 'not-a-real-scope',
              body: 'hello',
              recordJson: JSON.stringify({
                id: 'c1',
                scope: 'not-a-real-scope',
                provenance: {
                  origin: 'test',
                  actor: 'user:test',
                  source_hash: 'a'.repeat(64),
                  ingested_at: '2026-11-13T00:00:00.000Z',
                },
                trust: 'untrusted',
              }),
            }),
          (err) => err && err.code === 'UNKNOWN_MEMORY_SCOPE'
        );
      } finally {
        closeDatabase(db);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('writeIngestChunkToDb accepts known scope and persists via provenance helper', async () => {
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'nb7-write-'));
    const sqlitePath = path.join(tmp, 'memory.sqlite');
    try {
      const { db } = await openOrCreateDatabase(sqlitePath);
      try {
        const scope = assertKnownScope('repository');
        writeIngestChunkToDb(db, {
          chunkId: 'c-ok',
          path: 'README.md',
          workId: null,
          scope,
          body: 'body',
          startLine: 1,
          endLine: 1,
          contentSha256: 'b'.repeat(64),
          recordJson: JSON.stringify({
            id: 'c-ok',
            scope,
            provenance: {
              origin: 'test',
              actor: 'user:test',
              source_hash: 'b'.repeat(64),
              ingested_at: '2026-11-13T00:00:00.000Z',
            },
            trust: 'untrusted',
          }),
        });
        persistDatabase(db, sqlitePath);
        const stmt = db.prepare('SELECT chunk_id, scope FROM chunks WHERE chunk_id = ?');
        stmt.bind(['c-ok']);
        assert.ok(stmt.step());
        const row = stmt.getAsObject();
        stmt.free();
        assert.equal(row.chunk_id, 'c-ok');
        assert.equal(row.scope, 'repository');
      } finally {
        closeDatabase(db);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('MemoryService.withProjectDb opens through the adapter seam', async () => {
    const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'nb7-prime-'));
    const personal = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'nb7-personal-'));
    const prev = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = personal;
    fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"nb7"}\n');
    try {
      const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
      try {
        const seen = await svc.withProjectDb(async (db, ctx) => {
          assert.ok(db);
          assert.ok(ctx.sqlitePath);
          assert.equal(typeof ctx.store.withDb, 'function');
          return 'ok';
        });
        assert.equal(seen, 'ok');
      } finally {
        await svc.close();
      }
    } finally {
      if (prev === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
      else process.env.AGENTIC_SWE_PERSONAL_ROOT = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(personal, { recursive: true, force: true });
    }
  });
});
