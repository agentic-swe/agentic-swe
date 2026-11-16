'use strict';

/**
 * M4 audit NB7 / OT-01 AE-R2 — ingest/prime must not require graph-store directly;
 * modules outside scripts/lib/memory/ need an explicit allowlist (empty after OT-01).
 * Refs ADR-012, ADR-016; provenance writers remain graph-store helpers under the adapter.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
 * OT-01 / AE-R2 complete: session-capture + seed-memory-corpus migrated; allowlist empty.
 * Keep the Map so a future residual must re-add a justified entry (size must stay 0).
 */
const OUTSIDE_MEMORY_ALLOWLIST = new Map([]);

/** AE-R2 + OT-01 migrated paths — must not require graph-store directly. */
const MIGRATED_TO_MEMORY_SERVICE = [
  'scripts/lib/skills/ingest-project-skills.cjs',
  'scripts/lib/fleet/ingest-fleet-memory.cjs',
  'scripts/lib/skills/skill-router.cjs',
  'scripts/lib/descent/ladder.cjs',
  'scripts/lib/descent/mine-session-procedures.cjs',
  'scripts/session-capture.cjs',
  'scripts/seed-memory-corpus.cjs',
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

function parseNodeProvenance(row) {
  assert.ok(row.record_json, 'node must carry record_json');
  const parsed = JSON.parse(String(row.record_json));
  assert.ok(parsed.provenance && typeof parsed.provenance === 'object');
  for (const key of ['origin', 'actor', 'source_hash', 'ingested_at']) {
    assert.ok(String(parsed.provenance[key] || '').trim(), `missing provenance.${key}`);
  }
  return parsed.provenance;
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

  it('outside-memory graph-store allowlist is empty after OT-01', () => {
    assert.equal(
      OUTSIDE_MEMORY_ALLOWLIST.size,
      0,
      'OT-01 / AE-R2 complete: no outside-memory direct graph-store writers remain'
    );
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

  it('AE-R2/OT-01 migrated modules do not require graph-store', () => {
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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nb7-scope-'));
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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nb7-write-'));
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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nb7-prime-'));
    const personal = fs.mkdtempSync(path.join(os.tmpdir(), 'nb7-personal-'));
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

  it('session-capture CLI stamps provenance via MemoryService and stays stdout-clean', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ot01-sess-'));
    const personal = fs.mkdtempSync(path.join(os.tmpdir(), 'ot01-sess-personal-'));
    const prevPersonal = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = personal;
    try {
      const richTranscript = [
        '{"type":"user","message":{"role":"user","content":"Decision: migrate session-capture through MemoryService withProjectDb for AE-R2."}}',
        '{"type":"assistant","message":{"role":"assistant","content":"Lesson: provenance must stamp on every node write; never skip origin refs when closing the allowlist."}}',
      ].join('\n');
      const transcriptPath = path.join(tmp, 'session.jsonl');
      fs.writeFileSync(transcriptPath, richTranscript, 'utf8');

      const quiet = spawnSync(
        process.execPath,
        [
          path.join(pluginRoot, 'scripts/session-capture.cjs'),
          '--project-root',
          tmp,
          '--plugin-root',
          pluginRoot,
          '--transcript-path',
          transcriptPath,
          '--no-evolve',
        ],
        {
          encoding: 'utf8',
          cwd: tmp,
          env: {
            ...process.env,
            AGENTIC_SWE_PERSONAL_ROOT: personal,
            AGENTIC_SWE_HOOK_LIFECYCLE: '0',
            AGENTIC_SWE_EVOLVE_ON_STOP: '0',
          },
        }
      );
      assert.equal(quiet.status, 0, quiet.stderr + quiet.stdout);
      assert.equal(String(quiet.stdout || '').trim(), '', 'hook path must keep stdout clean without --json');

      const json = spawnSync(
        process.execPath,
        [
          path.join(pluginRoot, 'scripts/session-capture.cjs'),
          '--project-root',
          tmp,
          '--plugin-root',
          pluginRoot,
          '--transcript-path',
          transcriptPath,
          '--no-evolve',
          '--json',
        ],
        {
          encoding: 'utf8',
          cwd: tmp,
          env: {
            ...process.env,
            AGENTIC_SWE_PERSONAL_ROOT: personal,
            AGENTIC_SWE_HOOK_LIFECYCLE: '0',
            AGENTIC_SWE_EVOLVE_ON_STOP: '0',
          },
        }
      );
      assert.equal(json.status, 0, json.stderr + json.stdout);
      const payload = JSON.parse(json.stdout.trim());
      assert.equal(payload.ok, true);
      assert.ok(payload.chunks >= 1, 'expected transcript chunks indexed');

      const sqlitePath = path.join(tmp, '.agentic-swe', 'memory.sqlite');
      assert.ok(fs.existsSync(sqlitePath), 'memory.sqlite should exist');

      const { db } = await openOrCreateDatabase(sqlitePath);
      try {
        const chunkStmt = db.prepare(
          `SELECT chunk_id, record_json FROM chunks WHERE path LIKE '%.agentic-swe/sessions/%' LIMIT 20`
        );
        let chunkSaw = 0;
        while (chunkStmt.step()) {
          const row = chunkStmt.getAsObject();
          const parsed = JSON.parse(String(row.record_json || '{}'));
          assert.ok(parsed.provenance && parsed.provenance.origin, 'chunk provenance.origin');
          assert.ok(parsed.provenance.actor, 'chunk provenance.actor');
          assert.match(String(parsed.provenance.origin), /session-ingest:/);
          chunkSaw++;
        }
        chunkStmt.free();
        assert.ok(chunkSaw >= 1, 'expected session chunks with provenance');

        const nodeStmt = db.prepare('SELECT id, kind, record_json FROM nodes LIMIT 20');
        let nodeSaw = 0;
        while (nodeStmt.step()) {
          const row = nodeStmt.getAsObject();
          const prov = parseNodeProvenance(row);
          assert.match(String(prov.origin), /^session-capture:/);
          assert.equal(prov.actor, 'system:session-capture');
          nodeSaw++;
        }
        nodeStmt.free();
        // Distill may or may not emit nodes depending on evidence score; chunks are required.
        if (payload.nodes > 0) assert.ok(nodeSaw >= 1, 'expected distilled nodes with provenance');
      } finally {
        closeDatabase(db);
      }
    } finally {
      if (prevPersonal === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
      else process.env.AGENTIC_SWE_PERSONAL_ROOT = prevPersonal;
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(personal, { recursive: true, force: true });
    }
  });

  it('seed-memory-corpus stamps provenance via MemoryService', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ot01-seed-'));
    const personal = fs.mkdtempSync(path.join(os.tmpdir(), 'ot01-seed-personal-'));
    const prevPersonal = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = personal;
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), '{"name":"ot01-seed"}\n');
      fs.writeFileSync(path.join(tmp, 'CHANGELOG.md'), '- **Keep MemoryService seam** — no direct graph-store\n');
      fs.writeFileSync(path.join(tmp, '.version-bump.json'), '{"files":[]}\n');
      fs.writeFileSync(path.join(tmp, 'README.md'), '# ot01-seed\n');
      // Minimal git repo so extractGitConventions does not throw path issues.
      spawnSync('git', ['init'], { cwd: tmp, encoding: 'utf8' });
      spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-m', 'docs: memory seed'], {
        cwd: tmp,
        encoding: 'utf8',
      });

      const r = spawnSync(
        process.execPath,
        [
          path.join(pluginRoot, 'scripts/seed-memory-corpus.cjs'),
          '--project-root',
          tmp,
          '--plugin-root',
          pluginRoot,
          '--json',
        ],
        {
          encoding: 'utf8',
          cwd: tmp,
          env: { ...process.env, AGENTIC_SWE_PERSONAL_ROOT: personal },
        }
      );
      assert.equal(r.status, 0, r.stderr + r.stdout);
      const payload = JSON.parse(r.stdout.trim());
      assert.equal(payload.ok, true);
      assert.ok(payload.nodes >= 1, 'expected seeded nodes');

      const sqlitePath = path.join(tmp, '.agentic-swe', 'memory.sqlite');
      assert.ok(fs.existsSync(sqlitePath), 'seeded memory.sqlite');
      const { db } = await openOrCreateDatabase(sqlitePath);
      try {
        const stmt = db.prepare('SELECT id, kind, record_json FROM nodes LIMIT 50');
        let saw = 0;
        while (stmt.step()) {
          const row = stmt.getAsObject();
          const prov = parseNodeProvenance(row);
          assert.match(String(prov.origin), /^seed-memory-corpus:/);
          assert.equal(prov.actor, 'system:seed-memory-corpus');
          saw++;
        }
        stmt.free();
        assert.ok(saw >= 1, 'seeded nodes must carry provenance');
      } finally {
        closeDatabase(db);
      }
    } finally {
      if (prevPersonal === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
      else process.env.AGENTIC_SWE_PERSONAL_ROOT = prevPersonal;
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.rmSync(personal, { recursive: true, force: true });
    }
  });
});
