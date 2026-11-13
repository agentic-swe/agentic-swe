'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  createMemoryService,
  assertKnownScope,
  resolveScopeAtSeam,
  workIdForScope,
  sqlitePathForMemoryScope,
  isGitHistoryPath,
  GIT_HISTORY_PATH_PREFIX,
  MEMORY_SCOPES,
} = require('../scripts/lib/memory/memory-service.cjs');
const { personalRoot } = require('../scripts/lib/memory/scopes.cjs');
const { createNodeSqliteMemoryStore } = require('../scripts/lib/memory/adapters/node-sqlite-memory-store.cjs');

const pluginRoot = path.resolve(__dirname, '..');

function makeProvenance(origin) {
  return {
    origin,
    actor: 'user:test',
    source_hash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    ingested_at: '2026-11-13T05:00:00.000Z',
  };
}

describe('AE-030b MemoryService seam + scope router', () => {
  let tmp;
  let personal;
  let prevPersonal;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-030b-'));
    personal = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-030b-personal-'));
    prevPersonal = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = personal;
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'ae-030b-fixture', version: '1.0.0' })
    );
  });

  after(() => {
    if (prevPersonal === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
    else process.env.AGENTIC_SWE_PERSONAL_ROOT = prevPersonal;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(personal, { recursive: true, force: true });
  });

  it('write to execution/session scope is not returned by organizational/team read', async () => {
    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      await svc.write({
        id: 'mem:execution:secret-session',
        scope: 'execution',
        body: 'session-only decision: never leak to team query UNIQUE_SESSION_TOKEN_030b',
        provenance: makeProvenance('session-ingest'),
      });
      await svc.write({
        id: 'mem:org:team-lesson',
        scope: 'organizational',
        body: 'team sync lesson: prefer descent-first UNIQUE_TEAM_TOKEN_030b',
        provenance: makeProvenance('team-sync'),
      });

      const org = await svc.read({
        scope: 'organizational',
        query: 'UNIQUE_SESSION_TOKEN_030b',
      });
      assert.equal(org.records.length, 0, 'session body must not appear in organizational read');

      const orgTeam = await svc.read({
        scope: 'organizational',
        query: 'UNIQUE_TEAM_TOKEN_030b',
      });
      assert.equal(orgTeam.records.length, 1);
      assert.equal(orgTeam.records[0].scope, 'organizational');

      const exec = await svc.read({
        scope: 'execution',
        query: 'UNIQUE_SESSION_TOKEN_030b',
      });
      assert.equal(exec.records.length, 1);
      assert.equal(exec.records[0].scope, 'execution');
    } finally {
      await svc.close();
    }
  });

  it('personal/skill path uses personalRoot() only', async () => {
    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      const expected = path.join(personalRoot(), 'memory.sqlite');
      assert.equal(svc.sqlitePathForMemoryScope('skill'), expected);
      assert.equal(
        sqlitePathForMemoryScope('skill', { pluginRoot, projectRoot: tmp }),
        expected
      );
      assert.ok(expected.startsWith(path.resolve(personal) + path.sep) || expected === path.join(path.resolve(personal), 'memory.sqlite'));

      const written = await svc.write({
        id: 'mem:skill:style',
        scope: 'skill',
        body: 'personal style: prefer descent-first UNIQUE_PERSONAL_030b',
        provenance: makeProvenance('style-profile'),
        tenant_id: 'personal',
      });
      assert.equal(path.resolve(written.sqlitePath), path.resolve(expected));
      assert.ok(fs.existsSync(expected));
      // Must not create personal rows on the project sqlite.
      const projectDb = path.join(tmp, '.agentic-swe', 'memory.sqlite');
      if (fs.existsSync(projectDb)) {
        const projectStore = createNodeSqliteMemoryStore({ sqlitePath: projectDb });
        await projectStore.open();
        const rows = await projectStore.listChunks({ limit: 500 });
        await projectStore.close();
        assert.ok(
          !rows.some((r) => String(r.body || '').includes('UNIQUE_PERSONAL_030b')),
          'personal body must not land on project sqlite'
        );
      }

      const personalRead = await svc.read({
        scope: 'skill',
        query: 'UNIQUE_PERSONAL_030b',
      });
      assert.equal(personalRead.records.length, 1);
      assert.equal(personalRead.sqlitePath, expected);
    } finally {
      await svc.close();
    }
  });

  it('legacy work_id=team git-history rows read as repository (no in-place rewrite)', async () => {
    const projectDb = path.join(tmp, '.agentic-swe', 'memory.sqlite');
    fs.mkdirSync(path.dirname(projectDb), { recursive: true });
    const store = createNodeSqliteMemoryStore({ sqlitePath: projectDb });
    await store.open();
    // Simulate historical git-history ingest stamp (work_id=team, no scope column).
    await store.upsertChunk({
      chunkId: 'git-hist-legacy-1',
      path: `${GIT_HISTORY_PATH_PREFIX}abc123def456.md`,
      workId: 'team',
      scope: '', // blank → seam uses path+work_id
      body: 'commit abc author Dev subject UNIQUE_GIT_HIST_030b\nREADME.md',
      recordJson: null,
    });
    // True organizational sync event also work_id=team.
    await store.upsertChunk({
      chunkId: 'team-event-legacy-1',
      path: '.agentic-swe/sync/events/evt-1.json',
      workId: 'team',
      scope: '',
      body: 'team sync lesson UNIQUE_SYNC_EVENT_030b',
      recordJson: null,
    });
    await store.persist();
    await store.close();

    // Documented seam mapping (unit-level).
    assert.equal(
      resolveScopeAtSeam({
        work_id: 'team',
        path: `${GIT_HISTORY_PATH_PREFIX}abc123def456.md`,
      }),
      'repository'
    );
    assert.equal(
      resolveScopeAtSeam({
        work_id: 'team',
        path: '.agentic-swe/sync/events/evt-1.json',
      }),
      'organizational'
    );
    assert.ok(isGitHistoryPath(`${GIT_HISTORY_PATH_PREFIX}x.md`));
    assert.ok(!isGitHistoryPath('.agentic-swe/sync/events/x.json'));

    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      const repo = await svc.read({
        scope: 'repository',
        query: 'UNIQUE_GIT_HIST_030b',
      });
      assert.equal(repo.records.length, 1);
      assert.equal(repo.records[0].scope, 'repository');

      const org = await svc.read({
        scope: 'organizational',
        query: 'UNIQUE_GIT_HIST_030b',
      });
      assert.equal(org.records.length, 0, 'git-history must not surface as organizational');

      const orgSync = await svc.read({
        scope: 'organizational',
        query: 'UNIQUE_SYNC_EVENT_030b',
      });
      assert.equal(orgSync.records.length, 1);
      assert.equal(orgSync.records[0].scope, 'organizational');

      // Historical bytes unchanged: work_id still 'team' on disk.
      const verify = createNodeSqliteMemoryStore({ sqlitePath: projectDb });
      await verify.open();
      const rows = await verify.listChunks({ limit: 50 });
      await verify.close();
      const gitRow = rows.find((r) => r.chunk_id === 'git-hist-legacy-1');
      assert.ok(gitRow);
      assert.equal(gitRow.work_id, 'team');
      assert.match(String(gitRow.body), /UNIQUE_GIT_HIST_030b/);
    } finally {
      await svc.close();
    }
  });

  it('unknown scope fails closed with named error (does not default broader)', () => {
    assert.throws(
      () => assertKnownScope('fleet'),
      (err) =>
        err instanceof Error &&
        err.code === 'UNKNOWN_MEMORY_SCOPE' &&
        err.path === 'scope'
    );
    assert.throws(
      () => assertKnownScope(''),
      (err) => err.code === 'UNKNOWN_MEMORY_SCOPE' && err.path === 'scope'
    );
    assert.throws(
      () => workIdForScope('team'),
      (err) => err.code === 'UNKNOWN_MEMORY_SCOPE'
    );

    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    return svc
      .write({
        scope: 'session',
        body: 'should fail',
        provenance: makeProvenance('test'),
      })
      .then(
        () => {
          throw new Error('expected write to fail on legacy CLI scope name');
        },
        (err) => {
          assert.equal(err.code, 'UNKNOWN_MEMORY_SCOPE');
          assert.equal(err.path, 'scope');
        }
      )
      .finally(() => svc.close());
  });

  it('threads AE-030a required fields on write/read', async () => {
    const svc = createMemoryService({ pluginRoot, projectRoot: tmp });
    try {
      const written = await svc.write({
        id: 'mem:project:fields',
        scope: 'project',
        body: 'project distill UNIQUE_FIELDS_030b',
        provenance: makeProvenance('worklog-ingest'),
        trust: 'untrusted',
        retention_class: 'session',
        tenant_id: 'personal',
        visibility: 'private',
        redaction: { applied: true, ruleset: 'redact.cjs', hits: 0 },
      });
      assert.equal(written.trust, 'untrusted');
      assert.equal(written.retention_class, 'session');
      assert.equal(written.tenant_id, 'personal');
      assert.equal(written.redaction.applied, true);
      assert.ok(written.provenance.origin);

      const got = await svc.read({ scope: 'project', query: 'UNIQUE_FIELDS_030b' });
      assert.equal(got.records.length, 1);
      const rec = got.records[0];
      assert.equal(rec.scope, 'project');
      assert.equal(rec.trust, 'untrusted');
      assert.equal(rec.provenance.actor, 'user:test');
      assert.equal(rec.redaction.ruleset, 'redact.cjs');
    } finally {
      await svc.close();
    }
  });

  it('documents six scopes and workId stamps', () => {
    assert.deepEqual([...MEMORY_SCOPES], [
      'execution',
      'repository',
      'project',
      'skill',
      'organizational',
      'evaluation',
    ]);
    assert.equal(workIdForScope('execution'), 'session');
    assert.equal(workIdForScope('repository'), null);
    assert.equal(workIdForScope('skill'), 'personal');
    assert.equal(workIdForScope('organizational'), 'team');
    assert.equal(workIdForScope('evaluation'), 'evaluation');
  });
});

describe('AE-030b layering + verify (acceptance)', () => {
  it('npm run verify reports zero cycles and no new forbidden layer edges', () => {
    const cycles = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts/dependency-cycles.cjs')],
      { encoding: 'utf8', cwd: pluginRoot, env: { ...process.env } }
    );
    assert.equal(cycles.status, 0, cycles.stdout + cycles.stderr);
    assert.match(
      cycles.stdout + cycles.stderr,
      /dependency-cycles: OK \(.*0 file cycles, 0 module cycles\)/
    );

    const layers = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts/layer-lint.cjs')],
      { encoding: 'utf8', cwd: pluginRoot, env: { ...process.env } }
    );
    assert.equal(layers.status, 0, layers.stdout + layers.stderr);

    // Adapter stays under scripts/lib/memory (service); no sql.js require anywhere.
    const adapterSrc = fs.readFileSync(
      path.join(pluginRoot, 'scripts/lib/memory/adapters/node-sqlite-memory-store.cjs'),
      'utf8'
    );
    assert.match(adapterSrc, /graph-store\.cjs/);
    assert.doesNotMatch(adapterSrc, /require\(['"]sql\.js['"]\)/);
    const serviceSrc = fs.readFileSync(
      path.join(pluginRoot, 'scripts/lib/memory/memory-service.cjs'),
      'utf8'
    );
    assert.doesNotMatch(serviceSrc, /require\(['"]sql\.js['"]\)/);
    assert.match(serviceSrc, /adapters\/node-sqlite-memory-store/);
    assert.ok(
      !fs.existsSync(path.join(pluginRoot, 'scripts/lib/memory/adapters/sqljs-memory-store.cjs')),
      'sqljs adapter must be removed'
    );
  });
});
