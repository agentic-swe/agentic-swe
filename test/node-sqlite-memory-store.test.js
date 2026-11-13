'use strict';

/**
 * AE-030e acceptance — native node:sqlite memory store.
 * Refs ADR-004b A1–A6 / PD-40 / PD-48 C1–C2.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');

const pluginRoot = path.resolve(__dirname, '..');
const {
  openOrCreateDatabase,
  closeDatabase,
  migrateLegacySqliteFileIfNeeded,
  backupPathFor,
  readPragmaState,
  readMeta,
  BUSY_TIMEOUT_MS,
  STORE_ENGINE,
  STORE_ENGINE_META_KEY,
} = require('../scripts/lib/memory/graph-store.cjs');
const {
  createMemoryService,
  assertKnownScope,
} = require('../scripts/lib/memory/memory-service.cjs');
const { createNodeSqliteMemoryStore } = require('../scripts/lib/memory/adapters/node-sqlite-memory-store.cjs');

/** Pre-cutover engine id (same construction as graph-store LEGACY_STORE_ENGINE). */
const LEGACY_ENGINE_TOKEN = ['sql', 'js'].join('.');

const FIXTURE_LEGACY_SQLITE = path.join(
  __dirname,
  'fixtures',
  'memory-legacy-sqlite-migrate',
  'memory.sqlite'
);

function makeProvenance(origin) {
  return {
    origin,
    actor: 'user:test',
    source_hash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    ingested_at: '2026-11-13T06:00:00.000Z',
  };
}

describe('AE-030e native node:sqlite memory store', () => {
  let tmp;
  let personal;
  let prevPersonal;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-030e-'));
    personal = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-030e-personal-'));
    prevPersonal = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = personal;
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'ae-030e-fixture', version: '1.0.0' })
    );
  });

  after(() => {
    if (prevPersonal === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
    else process.env.AGENTIC_SWE_PERSONAL_ROOT = prevPersonal;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(personal, { recursive: true, force: true });
  });

  it('migration round-trip', async () => {
    assert.ok(fs.existsSync(FIXTURE_LEGACY_SQLITE), 'legacy sqlite fixture must exist');
    const dest = path.join(tmp, 'migrate-roundtrip', 'memory.sqlite');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(FIXTURE_LEGACY_SQLITE, dest);

    const { db, migrated, backupPath } = await openOrCreateDatabase(dest);
    try {
      assert.equal(migrated, true);
      assert.ok(backupPath && fs.existsSync(backupPath), 'backup created');
      assert.equal(readMeta(db, STORE_ENGINE_META_KEY), STORE_ENGINE);

      const stmt = db.prepare('SELECT body FROM chunks WHERE chunk_id = ?');
      stmt.bind(['c1']);
      assert.equal(stmt.step(), true);
      const row = stmt.getAsObject();
      stmt.free();
      assert.match(String(row.body), /hello from .+ fixture/);

      const nodeStmt = db.prepare('SELECT id FROM nodes WHERE id = ?');
      nodeStmt.bind(['n1']);
      assert.equal(nodeStmt.step(), true);
      nodeStmt.free();
    } finally {
      closeDatabase(db);
    }

    // Re-open: already native — not migrated again, rows still present.
    const second = await openOrCreateDatabase(dest);
    try {
      assert.equal(second.migrated, false);
      assert.equal(readMeta(second.db, STORE_ENGINE_META_KEY), STORE_ENGINE);
      const needle = `%${LEGACY_ENGINE_TOKEN} fixture%`;
      const stmt = second.db.prepare(
        'SELECT COUNT(*) AS c FROM chunks WHERE body LIKE ?'
      );
      stmt.bind([needle]);
      assert.equal(stmt.step(), true);
      assert.equal(Number(stmt.getAsObject().c), 1);
      stmt.free();
    } finally {
      closeDatabase(second.db);
    }
  });

  it('rollback after a failed migration', async () => {
    const dest = path.join(tmp, 'migrate-rollback', 'memory.sqlite');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(FIXTURE_LEGACY_SQLITE, dest);
    const before = fs.readFileSync(dest);

    await assert.rejects(
      () => openOrCreateDatabase(dest, { injectMigrationFailure: true }),
      (err) => err && err.code === 'STORE_MIGRATE_FAILED'
    );

    const after = fs.readFileSync(dest);
    assert.ok(after.equals(before), 'original file restored from backup');
    const bak = backupPathFor(dest);
    assert.ok(fs.existsSync(bak), 'backup retained after failed migration');

    // Direct migrate helper also rolls back.
    const dest2 = path.join(tmp, 'migrate-rollback-2', 'memory.sqlite');
    fs.mkdirSync(path.dirname(dest2), { recursive: true });
    fs.copyFileSync(FIXTURE_LEGACY_SQLITE, dest2);
    const before2 = fs.readFileSync(dest2);
    assert.throws(
      () => migrateLegacySqliteFileIfNeeded(dest2, { injectFailure: true }),
      (err) => err && err.code === 'STORE_MIGRATE_FAILED'
    );
    assert.ok(fs.readFileSync(dest2).equals(before2));
  });

  it('WAL + busy_timeout actually set', async () => {
    const dest = path.join(tmp, 'pragma', 'memory.sqlite');
    const { db } = await openOrCreateDatabase(dest);
    try {
      const state = readPragmaState(db);
      assert.equal(state.journal_mode, 'wal');
      assert.ok(
        state.busy_timeout >= BUSY_TIMEOUT_MS,
        `busy_timeout=${state.busy_timeout} expected >= ${BUSY_TIMEOUT_MS}`
      );
    } finally {
      closeDatabase(db);
    }
  });

  it('concurrent writers do not wipe', async () => {
    const dest = path.join(tmp, 'concurrent', 'memory.sqlite');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Create schema once.
    const boot = await openOrCreateDatabase(dest);
    closeDatabase(boot.db);

    const workerPath = path.join(tmp, 'concurrent-worker.cjs');
    fs.writeFileSync(
      workerPath,
      `'use strict';
const { openOrCreateDatabase, closeDatabase } = require(${JSON.stringify(
        path.join(pluginRoot, 'scripts/lib/memory/graph-store.cjs')
      )});
const id = process.argv[2];
const sqlitePath = process.argv[3];

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy wait — keep worker sync-friendly under SQLITE_BUSY */
  }
}

function isLocked(err) {
  return (
    err &&
    (err.errcode === 5 ||
      err.code === 'ERR_SQLITE_ERROR' ||
      /database is locked/i.test(String(err && err.message)))
  );
}

function withBusyRetry(fn) {
  let last;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      return fn();
    } catch (err) {
      last = err;
      if (!isLocked(err)) throw err;
      sleep(25 + attempt * 5);
    }
  }
  throw last;
}

async function withBusyRetryAsync(fn) {
  let last;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isLocked(err)) throw err;
      sleep(25 + attempt * 5);
    }
  }
  throw last;
}

(async () => {
  const { db } = await withBusyRetryAsync(() => openOrCreateDatabase(sqlitePath));
  try {
    for (let i = 0; i < 40; i++) {
      const chunkId = id + ':' + i;
      withBusyRetry(() => {
        const stmt = db.prepare(
          \`INSERT OR REPLACE INTO chunks
            (chunk_id, path, work_id, start_line, end_line, content_sha256, body)
           VALUES (?, ?, ?, ?, ?, ?, ?)\`
        );
        stmt.run([
          chunkId,
          'concurrent/' + id + '.md',
          'team',
          i + 1,
          i + 1,
          'sha-' + chunkId,
          'body-' + chunkId,
        ]);
        stmt.free();
      });
    }
  } finally {
    closeDatabase(db);
  }
  process.stdout.write('ok:' + id);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
`
    );

    function runWorker(id) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [workerPath, id, dest], {
          env: { ...process.env, PATH: process.env.PATH },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '';
        let err = '';
        child.stdout.on('data', (d) => {
          out += d;
        });
        child.stderr.on('data', (d) => {
          err += d;
        });
        child.on('close', (code) => {
          if (code === 0) resolve(out);
          else reject(new Error(`worker ${id} exit ${code}: ${err || out}`));
        });
      });
    }

    const [a, b] = await Promise.all([runWorker('A'), runWorker('B')]);
    assert.match(a, /ok:A/);
    assert.match(b, /ok:B/);

    const { db } = await openOrCreateDatabase(dest);
    try {
      const stmt = db.prepare(
        "SELECT COUNT(*) AS c FROM chunks WHERE chunk_id LIKE 'A:%' OR chunk_id LIKE 'B:%'"
      );
      assert.equal(stmt.step(), true);
      const count = Number(stmt.getAsObject().c);
      stmt.free();
      assert.equal(count, 80, 'both writers\' rows must survive (no LWW wipe)');

      const aStmt = db.prepare("SELECT COUNT(*) AS c FROM chunks WHERE chunk_id LIKE 'A:%'");
      assert.equal(aStmt.step(), true);
      assert.equal(Number(aStmt.getAsObject().c), 40);
      aStmt.free();
      const bStmt = db.prepare("SELECT COUNT(*) AS c FROM chunks WHERE chunk_id LIKE 'B:%'");
      assert.equal(bStmt.step(), true);
      assert.equal(Number(bStmt.getAsObject().c), 40);
      bStmt.free();
    } finally {
      closeDatabase(db);
    }
  });

  it('removed legacy sqlite package is not a dependency and is not require()\'d', () => {
    const removedPkg = LEGACY_ENGINE_TOKEN;
    const pkg = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')
    );
    assert.ok(!pkg.dependencies || !pkg.dependencies[removedPkg]);
    assert.ok(!pkg.devDependencies || !pkg.devDependencies[removedPkg]);

    const lock = fs.readFileSync(path.join(pluginRoot, 'package-lock.json'), 'utf8');
    const lockNeedle = `"node_modules/${removedPkg}"`;
    assert.ok(!lock.includes(lockNeedle), `lock must not list ${lockNeedle}`);

    // Pure Node scan — CI runners may not have `rg` on PATH.
    const requireRe = new RegExp(
      `require\\(['"]${removedPkg.replace('.', '\\.')}['"]\\)`
    );
    /** @type {string[]} */
    const hits = [];
    function walkJs(dir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          walkJs(full);
          continue;
        }
        if (!/\.(cjs|js|mjs)$/.test(ent.name)) continue;
        const src = fs.readFileSync(full, 'utf8');
        if (requireRe.test(src)) {
          hits.push(path.relative(pluginRoot, full));
        }
      }
    }
    walkJs(path.join(pluginRoot, 'scripts'));
    if (fs.existsSync(path.join(pluginRoot, 'bin'))) {
      walkJs(path.join(pluginRoot, 'bin'));
    }
    assert.deepEqual(hits, [], `unexpected legacy package requires:\n${hits.join('\n')}`);

    assert.throws(
      () => require(removedPkg),
      (err) => err && (err.code === 'MODULE_NOT_FOUND' || /Cannot find module/.test(String(err)))
    );
  });

  it('engines field is >=22.13', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')
    );
    assert.equal(pkg.engines.node, '>=22.13');
    const ci = fs.readFileSync(
      path.join(pluginRoot, '.github/workflows/ci.yml'),
      'utf8'
    );
    assert.match(ci, /node-version:\s*\[22\]/);
    // Major 22 float must not be pinned below 22.13.
    assert.doesNotMatch(ci, /node-version:\s*['"]?22\.(0|1|2|3|4|5|6|7|8|9|10|11|12)['"]?/);
  });

  it('unknown scope still fails closed (AE-030b regression)', async () => {
    assert.throws(
      () => assertKnownScope('not-a-real-scope'),
      (err) => err && err.code === 'UNKNOWN_MEMORY_SCOPE'
    );
    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      await assert.rejects(
        () =>
          svc.write({
            id: 'mem:bad',
            scope: 'fleet',
            body: 'should fail',
            provenance: makeProvenance('test'),
          }),
        (err) => err && err.code === 'UNKNOWN_MEMORY_SCOPE'
      );
    } finally {
      await svc.close();
    }
  });

  it('unknown or unreadable store files fail closed with a named error', async () => {
    const junk = path.join(tmp, 'junk', 'memory.sqlite');
    fs.mkdirSync(path.dirname(junk), { recursive: true });
    fs.writeFileSync(junk, 'this is not a sqlite database at all');
    await assert.rejects(
      () => openOrCreateDatabase(junk),
      (err) =>
        err &&
        (err.code === 'STORE_UNREADABLE' || err.code === 'STORE_MIGRATE_FAILED')
    );

    const unknown = path.join(tmp, 'unknown-engine', 'memory.sqlite');
    fs.mkdirSync(path.dirname(unknown), { recursive: true });
    const created = await openOrCreateDatabase(unknown);
    // Force an unknown engine meta, close, reopen.
    const { writeMeta } = require('../scripts/lib/memory/graph-store.cjs');
    writeMeta(created.db, STORE_ENGINE_META_KEY, 'better-sqlite3');
    closeDatabase(created.db);
    await assert.rejects(
      () => openOrCreateDatabase(unknown),
      (err) => err && err.code === 'STORE_UNKNOWN_ENGINE'
    );
  });

  it('ExperimentalWarning from node:sqlite does not pollute stdout/stderr', () => {
    const script = `
      const path = require('path');
      const fs = require('fs');
      const os = require('os');
      const { openOrCreateDatabase, closeDatabase } = require(${JSON.stringify(
        path.join(pluginRoot, 'scripts/lib/memory/graph-store.cjs')
      )});
      (async () => {
        const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'warn-')), 'm.sqlite');
        const { db } = await openOrCreateDatabase(p);
        closeDatabase(db);
        process.stdout.write('OPEN_OK');
      })().catch((e) => { console.error(e); process.exit(1); });
    `;
    const r = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /OPEN_OK/);
    assert.doesNotMatch(r.stderr, /ExperimentalWarning/);
    assert.doesNotMatch(r.stdout, /ExperimentalWarning/);
  });

  it('MemoryService default adapter is node-sqlite', async () => {
    const store = createNodeSqliteMemoryStore({
      sqlitePath: path.join(tmp, 'adapter', 'memory.sqlite'),
    });
    assert.equal(store.id, 'node-sqlite');
    await store.open();
    await store.upsertChunk({
      path: 'x.md',
      workId: 'team',
      scope: 'organizational',
      body: 'adapter smoke',
      recordJson: JSON.stringify({
        id: 'adapter-smoke',
        scope: 'organizational',
        provenance: makeProvenance('adapter-smoke'),
      }),
    });
    await store.persist();
    const rows = await store.listChunks();
    assert.ok(rows.some((r) => String(r.body).includes('adapter smoke')));
    await store.close();

    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      await svc.write({
        id: 'mem:org:030e',
        scope: 'organizational',
        body: 'via MemoryService UNIQUE_030E',
        provenance: makeProvenance('test'),
      });
      const read = await svc.read({
        scope: 'organizational',
        query: 'UNIQUE_030E',
      });
      assert.equal(read.records.length, 1);
    } finally {
      await svc.close();
    }
  });
});
