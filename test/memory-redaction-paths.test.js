'use strict';

const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { redactSecrets } = require('../scripts/lib/memory/session-capture.cjs');
const { runMemoryIndex } = require('../scripts/lib/memory/memory-pipeline.cjs');
const { runIncrementalIndex } = require('../scripts/lib/memory/incremental-index.cjs');
const { ingestOrganicWorklogs } = require('../scripts/lib/memory/ingest-scopes.cjs');
const { writeCompactArtifact } = require('../scripts/lib/memory/memory-compact.cjs');
const { buildSlidingSummaryMarkdown } = require('../scripts/lib/memory/transcript-sliding.cjs');
const { appendLocalEvent } = require('../scripts/lib/sync/git-sync.cjs');
const { buildPrimeMarkdown } = require('../scripts/lib/memory/memory-prime.cjs');
const { openOrCreateDatabase, closeDatabase } = require('../scripts/lib/memory/graph-store.cjs');
const { writeLessons } = require('../scripts/lib/memory/lessons.cjs');

const pluginRoot = path.join(__dirname, '..');
const SECRET = 'FAKEKEY1234567890abcdef';
const AWS = 'AKIAFAKEFAKEFAKE1234';
const EMAIL = 'jane.doe@example.com';
const PASSWORD = 'hunter2-not-real';
const LEAKS = [SECRET, AWS, EMAIL, PASSWORD, 'ghp_abcdefghijklmnopqrstuvwxyz1234567890'];

function assertNoLeaks(text) {
  for (const leak of LEAKS) assert.ok(!text.includes(leak), leak);
}

describe('redactSecrets coverage', () => {
  it('redacts the memory-audit misses and leaves ordinary prose', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature1';
    const dsn = 'postgres://app:s3cret@db.internal:5432/app';
    const raw = [
      `api_key=${SECRET}`,
      `AWS key ${AWS}`,
      `Customer email ${EMAIL} reported the bug.`,
      `DB password is ${PASSWORD}`,
      `token=ghp_abcdefghijklmnopqrstuvwxyz1234567890`,
      jwt,
      dsn,
      'the password is optional for local dev',
    ].join('\n');
    const { redacted, hits } = redactSecrets(raw);
    assert.ok(hits >= 6);
    assertNoLeaks(redacted);
    assert.ok(!redacted.includes('eyJhbGci'));
    assert.ok(!redacted.includes('postgres://'));
    assert.match(redacted, /password is optional/);
  });
});

describe('memory write paths redact before persistence', { concurrency: false }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-r12-'));
  const note = [
    '# Client',
    `Configured client with api_key=${SECRET} and AWS key ${AWS} for staging.`,
    `Customer email ${EMAIL} reported the bug.`,
    `DB password is ${PASSWORD}`,
  ].join('\n');

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('repo index and incremental refresh do not store the secret', async () => {
    const rel = path.join(tmp, '.worklogs', 'w1', 'implementation.md');
    fs.mkdirSync(path.dirname(rel), { recursive: true });
    fs.writeFileSync(rel, note, 'utf8');
    const indexed = await runMemoryIndex({ projectRoot: tmp, pluginRoot, skipGraph: true });
    const stored = await chunkText(indexed.sqlitePath);
    assertNoLeaks(stored);
    assert.match(stored, /staging/);

    fs.writeFileSync(rel, `${note}\n\nAdded token=ghp_abcdefghijklmnopqrstuvwxyz1234567890\n`, 'utf8');
    const bumped = new Date(Date.now() + 5000);
    fs.utimesSync(rel, bumped, bumped);
    const refreshed = await runIncrementalIndex({ projectRoot: tmp, pluginRoot });
    assert.ok(refreshed.updated >= 1);
    assertNoLeaks(await chunkText(indexed.sqlitePath));
  });

  it('organic worklog distillation redacts the stored chunk and node', async () => {
    const dir = path.join(tmp, '.worklogs', 'organic1');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'state.json'),
      JSON.stringify({
        current_state: 'completed',
        task: `wire api_key=${SECRET}`,
        history: [{ to: 'validation' }, { to: 'completed' }],
      })
    );
    fs.writeFileSync(path.join(dir, 'implementation.md'), note, 'utf8');
    const result = await ingestOrganicWorklogs({ projectRoot: tmp, pluginRoot });
    assert.strictEqual(result.chunks, 1);
    const stored = await chunkText(result.sqlitePath);
    assertNoLeaks(stored);
    const { db } = await openOrCreateDatabase(result.sqlitePath);
    try {
      const stmt = db.prepare("SELECT label, meta_json FROM nodes WHERE id = 'worklog:organic1'");
      assert.strictEqual(stmt.step(), true);
      const row = stmt.getAsObject();
      stmt.free();
      assertNoLeaks(`${row.label}\n${row.meta_json}`);
    } finally {
      closeDatabase(db);
    }
  });

  it('compact, sliding summary, lessons, and sync events redact', async () => {
    const workDir = path.join(tmp, '.worklogs', 'wi-compact');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'progress.md'), note, 'utf8');
    fs.writeFileSync(
      path.join(workDir, 'reflection-log.md'),
      `- **What failed**: deploy\n- **Root cause**: password is ${PASSWORD} leaked\n- **Strategy change**: rotate\n`,
      'utf8'
    );
    const compact = writeCompactArtifact({ workDirAbs: workDir, pluginRoot });
    assertNoLeaks(fs.readFileSync(compact.outputPath, 'utf8'));

    const summary = await buildSlidingSummaryMarkdown(
      [{ role: 'user', text: note, ts: null }],
      { recentVerbatim: 8, maxOldChars: 240 }
    );
    assertNoLeaks(summary);
    assert.match(summary, /Recent turns/);

    const lessonsPath = writeLessons(tmp);
    assertNoLeaks(fs.readFileSync(lessonsPath, 'utf8'));

    const eventFile = appendLocalEvent({
      projectRoot: tmp,
      event: { kind: 'lesson', label: `token=ghp_abcdefghijklmnopqrstuvwxyz1234567890`, scope: 'team' },
    });
    assertNoLeaks(fs.readFileSync(eventFile, 'utf8'));
  });

  it('memory prime does not return a stored secret', async () => {
    const md = await buildPrimeMarkdown({
      projectRoot: tmp,
      pluginRoot,
      query: 'staging',
    });
    assertNoLeaks(md);
    assert.match(md, /staging/);
  });
});

async function chunkText(sqlitePath) {
  const { db } = await openOrCreateDatabase(sqlitePath);
  try {
    const stmt = db.prepare('SELECT body FROM chunks');
    const parts = [];
    while (stmt.step()) parts.push(String(stmt.getAsObject().body || ''));
    stmt.free();
    const nodes = db.prepare('SELECT label, meta_json FROM nodes');
    while (nodes.step()) {
      const row = nodes.getAsObject();
      parts.push(String(row.label || ''), String(row.meta_json || ''));
    }
    nodes.free();
    return parts.join('\n');
  } finally {
    closeDatabase(db);
  }
}
