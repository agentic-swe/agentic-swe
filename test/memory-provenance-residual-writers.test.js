'use strict';

/**
 * AE-030h4 — residual writers (fleet / ingest-scopes / project-skills) must use
 * provenance-checked upsertChunkRow; guard against new direct chunk INSERTs.
 * Refs ADR-012 A4 / Finding B1 residual.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pluginRoot = path.resolve(__dirname, '..');
const {
  openOrCreateDatabase,
  closeDatabase,
} = require('../scripts/lib/memory/graph-store.cjs');
const { insertScopedChunk } = require('../scripts/lib/memory/ingest-scopes.cjs');
const {
  ingestTeamEvents,
  ingestPersonalProfile,
  ingestOrganicWorklogs,
  ingestGitTeamHistory,
  ingestMuscleReplayWorklogs,
} = require('../scripts/lib/memory/ingest-scopes.cjs');
const { ingestFleetSubmissionMemory } = require('../scripts/lib/fleet/ingest-fleet-memory.cjs');
const { ingestProjectSkills } = require('../scripts/lib/skills/ingest-project-skills.cjs');
const { scaffoldProjectSkillFromRitual } = require('../scripts/lib/skills/project-skills.cjs');
const { EVENTS_DIR } = require('../scripts/lib/sync/git-sync.cjs');

/** Production modules that may own the only checked chunk/node/edge INSERT. */
const ALLOWED_CHUNK_INSERT_FILES = new Set([
  path.normalize('scripts/lib/memory/graph-store.cjs'),
]);
const ALLOWED_GRAPH_INSERT_FILES = new Set([
  path.normalize('scripts/lib/memory/graph-store.cjs'),
]);

const SCAN_ROOTS = [
  path.join(pluginRoot, 'scripts', 'lib', 'memory'),
  path.join(pluginRoot, 'scripts', 'lib', 'fleet'),
  path.join(pluginRoot, 'scripts', 'lib', 'skills'),
  path.join(pluginRoot, 'scripts'),
  path.join(pluginRoot, 'hooks'),
];

const CHUNK_INSERT_RE =
  /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+chunks\b|REPLACE\s+INTO\s+chunks\b/i;
const NODE_INSERT_RE =
  /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+nodes\b|REPLACE\s+INTO\s+nodes\b/i;
const EDGE_INSERT_RE =
  /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+edges\b|REPLACE\s+INTO\s+edges\b/i;

function walkJsFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      walkJsFiles(abs, out);
    } else if (ent.isFile() && /\.(cjs|js|mjs)$/.test(ent.name)) {
      out.push(abs);
    }
  }
}

function parseProvenance(row) {
  assert.ok(row.record_json, 'row must carry record_json');
  const parsed = JSON.parse(String(row.record_json));
  assert.ok(parsed.provenance && typeof parsed.provenance === 'object');
  for (const key of ['origin', 'actor', 'source_hash', 'ingested_at']) {
    assert.ok(String(parsed.provenance[key] || '').trim(), `missing provenance.${key}`);
  }
  return parsed.provenance;
}

function copyMemoryConfig(destRoot) {
  fs.mkdirSync(path.join(destRoot, 'config'), { recursive: true });
  fs.copyFileSync(
    path.join(pluginRoot, 'config/memory.default.json'),
    path.join(destRoot, 'config/memory.default.json')
  );
}

describe('AE-030h4 residual memory writers provenance', () => {
  let tmp;
  let personal;
  let prevPersonal;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-030h4-'));
    personal = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-030h4-personal-'));
    prevPersonal = process.env.AGENTIC_SWE_PERSONAL_ROOT;
    process.env.AGENTIC_SWE_PERSONAL_ROOT = personal;
  });

  after(() => {
    if (prevPersonal === undefined) delete process.env.AGENTIC_SWE_PERSONAL_ROOT;
    else process.env.AGENTIC_SWE_PERSONAL_ROOT = prevPersonal;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(personal, { recursive: true, force: true });
  });

  it('guard: no direct INSERT into chunks outside graph-store upsertChunkRow', () => {
    const files = [];
    for (const root of SCAN_ROOTS) walkJsFiles(root, files);
    const uniq = [...new Set(files)];
    const offenders = [];
    for (const abs of uniq) {
      const rel = path.relative(pluginRoot, abs).split(path.sep).join('/');
      if (ALLOWED_CHUNK_INSERT_FILES.has(path.normalize(rel))) continue;
      // Tests live under test/ — not scanned. Scripts that only require helpers OK.
      const text = fs.readFileSync(abs, 'utf8');
      if (CHUNK_INSERT_RE.test(text)) {
        offenders.push(rel);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `direct chunk INSERT outside checked helper:\n${offenders.join('\n')}`
    );
  });

  it('guard: no direct INSERT into nodes/edges outside graph-store helpers', () => {
    const files = [];
    for (const root of SCAN_ROOTS) walkJsFiles(root, files);
    const uniq = [...new Set(files)];
    const offenders = [];
    for (const abs of uniq) {
      const rel = path.relative(pluginRoot, abs).split(path.sep).join('/');
      if (ALLOWED_GRAPH_INSERT_FILES.has(path.normalize(rel))) continue;
      const text = fs.readFileSync(abs, 'utf8');
      if (NODE_INSERT_RE.test(text) || EDGE_INSERT_RE.test(text)) {
        offenders.push(rel);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `direct nodes/edges INSERT outside checked helper:\n${offenders.join('\n')}`
    );
  });

  it('insertScopedChunk without provenance fails closed', async () => {
    const dbPath = path.join(tmp, 'scoped-fail', 'memory.sqlite');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const { db } = await openOrCreateDatabase(dbPath);
    try {
      assert.throws(
        () =>
          insertScopedChunk(db, {
            path: 'no-prov.md',
            workId: 'team',
            body: 'should fail closed',
          }),
        (err) => err && err.code === 'MISSING_PROVENANCE'
      );
      assert.throws(
        () =>
          insertScopedChunk(db, {
            path: 'blank-actor.md',
            workId: 'team',
            body: 'should fail closed',
            source: 'test',
            originPathOrEvent: 'blank-actor.md',
            actor: '   ',
          }),
        (err) => err && err.code === 'MISSING_PROVENANCE'
      );
    } finally {
      closeDatabase(db);
    }
  });

  it('fleet-ingest writes rows that carry provenance', async () => {
    const root = path.join(tmp, 'fleet');
    copyMemoryConfig(root);
    const archivePath = path.join(
      root,
      'bench',
      'results',
      'fleet-submissions',
      'h4-archive.json'
    );
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.writeFileSync(archivePath, '{}');
    const submission = {
      project_root: '/tmp/consumer-h4',
      fleet_evidence_class: 'independent',
      evidence: {
        submission_readiness: { organic_live: 1, portfolio_multiplier: 0.01 },
        procedures: { evaluated: 0, ritual_skills: [] },
      },
    };
    const r = await ingestFleetSubmissionMemory({
      submission,
      pluginRoot: root,
      archivePath,
    });
    assert.equal(r.ok, true);
    const { db } = await openOrCreateDatabase(r.sqlitePath);
    try {
      const stmt = db.prepare(
        `SELECT chunk_id, path, body, record_json FROM chunks WHERE body LIKE ?`
      );
      stmt.bind(['%fleet submission ingested%']);
      assert.ok(stmt.step());
      const row = stmt.getAsObject();
      stmt.free();
      const prov = parseProvenance(row);
      assert.match(String(prov.origin), /^fleet-ingest:/);
      assert.equal(prov.actor, 'system:fleet-ingest');
      assert.ok(String(prov.source_uri || '').includes('h4-archive.json'));
    } finally {
      closeDatabase(db);
    }
  });

  it('fleet-ingest fails closed when provenance builder inputs are blank', async () => {
    // Force fail-closed by calling insert path with empty archiveRel via a direct
    // upsert attempt mirroring fleet's required fields — blank actor/source.
    const dbPath = path.join(tmp, 'fleet-fail', 'memory.sqlite');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const { db } = await openOrCreateDatabase(dbPath);
    const { upsertChunkRow } = require('../scripts/lib/memory/graph-store.cjs');
    try {
      assert.throws(
        () =>
          upsertChunkRow(db, {
            path: 'fleet-blank.md',
            workId: 'team',
            scope: 'organizational',
            body: 'no provenance',
            recordJson: JSON.stringify({ provenance: null }),
          }),
        (err) => err && err.code === 'MISSING_PROVENANCE'
      );
    } finally {
      closeDatabase(db);
    }
  });

  it('ingest-scopes team-events writes rows that carry provenance', async () => {
    const root = path.join(tmp, 'team-events');
    copyMemoryConfig(root);
    const eventsDir = path.join(root, EVENTS_DIR);
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, 'evt-h4.json'),
      JSON.stringify({
        id: 'evt-h4',
        kind: 'sync',
        label: 'UNIQUE_TEAM_EVENT_PROV',
        ts: '2026-11-13T00:00:00.000Z',
        scope: 'team',
      })
    );
    const r = await ingestTeamEvents({ projectRoot: root, pluginRoot: root });
    assert.equal(r.ok, true);
    assert.ok(r.events >= 1);
    const { db } = await openOrCreateDatabase(r.sqlitePath);
    try {
      const stmt = db.prepare(
        `SELECT chunk_id, path, body, record_json FROM chunks WHERE body LIKE ?`
      );
      stmt.bind(['%UNIQUE_TEAM_EVENT_PROV%']);
      assert.ok(stmt.step());
      const row = stmt.getAsObject();
      stmt.free();
      const prov = parseProvenance(row);
      assert.match(String(prov.origin), /^ingest-scopes:team-events:/);
      assert.equal(prov.actor, 'system:ingest-scopes');
    } finally {
      closeDatabase(db);
    }
  });

  it('ingest-scopes personal-profile writes rows that carry provenance', async () => {
    const root = path.join(tmp, 'personal-profile');
    copyMemoryConfig(root);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'h4-personal', version: '1.0.0' })
    );
    const r = await ingestPersonalProfile({ projectRoot: root, pluginRoot: root });
    assert.equal(r.ok, true);
    const { db } = await openOrCreateDatabase(r.sqlitePath);
    try {
      const stmt = db.prepare(
        `SELECT chunk_id, path, body, record_json FROM chunks WHERE path = ?`
      );
      stmt.bind(['personal/style-profile.md']);
      assert.ok(stmt.step());
      const row = stmt.getAsObject();
      stmt.free();
      const prov = parseProvenance(row);
      assert.match(String(prov.origin), /^ingest-scopes:personal-profile:/);
      assert.equal(prov.actor, 'system:ingest-scopes');
    } finally {
      closeDatabase(db);
    }
  });

  it('ingest-scopes organic-worklogs writes rows that carry provenance', async () => {
    const root = path.join(tmp, 'organic');
    copyMemoryConfig(root);
    const wid = 'organic-h4-item';
    const dir = path.join(root, '.worklogs', wid);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'state.json'),
      JSON.stringify({
        current_state: 'completed',
        task: 'UNIQUE_ORGANIC_PROV organic distill',
        pipeline: { track: 'lean' },
        history: [
          { from: 'initialized', to: 'feasibility', actor: 'test' },
          { from: 'feasibility', to: 'completed', actor: 'test' },
        ],
      })
    );
    fs.writeFileSync(path.join(dir, 'implementation.md'), '# UNIQUE_ORGANIC_PROV impl\n');
    const r = await ingestOrganicWorklogs({ projectRoot: root, pluginRoot: root });
    assert.equal(r.ok, true);
    assert.ok(r.chunks >= 1);
    const { db } = await openOrCreateDatabase(r.sqlitePath);
    try {
      const stmt = db.prepare(
        `SELECT chunk_id, path, body, record_json FROM chunks WHERE body LIKE ?`
      );
      stmt.bind(['%UNIQUE_ORGANIC_PROV%']);
      assert.ok(stmt.step());
      const row = stmt.getAsObject();
      stmt.free();
      const prov = parseProvenance(row);
      assert.match(String(prov.origin), /^ingest-scopes:organic-worklogs:/);
      assert.equal(prov.actor, 'system:ingest-scopes');
    } finally {
      closeDatabase(db);
    }
  });

  it('ingest-scopes muscle-replay writes rows that carry provenance', async () => {
    const root = path.join(tmp, 'muscle');
    copyMemoryConfig(root);
    const wid = 'muscle-h4-item';
    const dir = path.join(root, '.worklogs', wid);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'descent-replay.md'), '# UNIQUE_MUSCLE_PROV replay\n');
    const r = await ingestMuscleReplayWorklogs({ projectRoot: root, pluginRoot: root });
    assert.equal(r.ok, true);
    assert.ok(r.chunks >= 1);
    const { db } = await openOrCreateDatabase(r.sqlitePath);
    try {
      const stmt = db.prepare(
        `SELECT chunk_id, path, body, record_json FROM chunks WHERE body LIKE ?`
      );
      stmt.bind(['%UNIQUE_MUSCLE_PROV%']);
      assert.ok(stmt.step());
      const row = stmt.getAsObject();
      stmt.free();
      const prov = parseProvenance(row);
      assert.match(String(prov.origin), /^ingest-scopes:muscle-replay:/);
      assert.equal(prov.actor, 'system:ingest-scopes');
    } finally {
      closeDatabase(db);
    }
  });

  it('ingest-scopes git-history writes rows that carry provenance when git available', async () => {
    const root = path.join(tmp, 'git-hist');
    copyMemoryConfig(root);
    const { spawnSync } = require('node:child_process');
    fs.writeFileSync(path.join(root, 'README.md'), 'UNIQUE_GIT_PROV seed\n');
    spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.email', 'h4@example.com'], { cwd: root });
    spawnSync('git', ['config', 'user.name', 'H4'], { cwd: root });
    spawnSync('git', ['add', 'README.md'], { cwd: root });
    spawnSync('git', ['commit', '-m', 'UNIQUE_GIT_PROV commit'], { cwd: root });
    const r = await ingestGitTeamHistory({ projectRoot: root, pluginRoot: root, maxCommits: 5 });
    assert.equal(r.ok, true);
    if (r.commits === 0) {
      // Environment without git — skip assert rather than weaken.
      assert.ok(r.reason);
      return;
    }
    const { db } = await openOrCreateDatabase(r.sqlitePath);
    try {
      const stmt = db.prepare(
        `SELECT chunk_id, path, body, record_json FROM chunks WHERE body LIKE ?`
      );
      stmt.bind(['%UNIQUE_GIT_PROV%']);
      assert.ok(stmt.step());
      const row = stmt.getAsObject();
      stmt.free();
      const prov = parseProvenance(row);
      assert.match(String(prov.origin), /^ingest-scopes:git-history:/);
      assert.equal(prov.actor, 'system:ingest-scopes');
    } finally {
      closeDatabase(db);
    }
  });

  it('ingest-project-skills writes rows that carry provenance', async () => {
    const root = path.join(tmp, 'project-skills');
    copyMemoryConfig(root);
    scaffoldProjectSkillFromRitual({
      projectRoot: root,
      skillName: 'h4-lint',
      verifyCommand: 'npm run h4-lint',
    });
    const r = await ingestProjectSkills({ projectRoot: root, pluginRoot: root });
    assert.equal(r.ok, true);
    assert.equal(r.chunks, 1);
    const { db } = await openOrCreateDatabase(r.sqlitePath);
    try {
      const stmt = db.prepare(
        `SELECT chunk_id, path, body, record_json FROM chunks WHERE path LIKE ?`
      );
      stmt.bind(['%h4-lint%']);
      assert.ok(stmt.step());
      const row = stmt.getAsObject();
      stmt.free();
      const prov = parseProvenance(row);
      assert.match(String(prov.origin), /^ingest-project-skills:/);
      assert.equal(prov.actor, 'system:ingest-project-skills');
    } finally {
      closeDatabase(db);
    }
  });
});
