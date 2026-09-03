'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { warmChatMemory } = require('../scripts/session-chat-warm.cjs');
const { loadStore } = require('../scripts/lib/descent/promotion.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('session chat warm', () => {
  it('ingests transcripts and mines session + transcript-tool procedures', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-warm-'));
    fs.mkdirSync(path.join(tmp, 'test'), { recursive: true });
    const testRel = 'test/ok.test.js';
    fs.writeFileSync(
      path.join(tmp, testRel),
      `'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
describe('ok', () => { it('passes', () => assert.equal(1, 1)); });
`
    );
    const sessions = path.join(tmp, '.agentic-swe', 'sessions');
    fs.mkdirSync(sessions, { recursive: true });
    const absTest = path.join(tmp, testRel);
    const verify = `node --test ${testRel}`;
    fs.writeFileSync(
      path.join(sessions, 'session.jsonl'),
      JSON.stringify({
        role: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'Re-running isolated acceptance from this session.' },
            { type: 'tool_use', name: 'Read', input: { path: absTest } },
            { type: 'tool_use', name: 'Shell', input: { command: verify } },
          ],
        },
      }) + '\n'
    );
    fs.writeFileSync(
      path.join(sessions, 'lesson.jsonl'),
      JSON.stringify({
        role: 'user',
        message: { content: [{ type: 'text', text: 'Always run node --test test/ok.test.js before merge.' }] },
      }) + '\n'
    );

    const r = await warmChatMemory({ projectRoot: tmp, pluginRoot, limit: 8 });
    assert.ok(r.transcripts >= 1);
    assert.ok(r.session.procedures >= 0);
    assert.ok(r.transcript.procedures >= 1, JSON.stringify(r.transcript));

    const store = loadStore(tmp);
    const tx = store.procedures.find((p) => p.procedure?._meta?.source === 'transcript-tools');
    assert.ok(tx, 'expected transcript-tools procedure');
    assert.equal(tx.eval_status, 'evaluated');

    const { appendLocalEvent } = require('../scripts/lib/sync/git-sync.cjs');
    appendLocalEvent({
      projectRoot: tmp,
      event: { kind: 'lesson', label: 'team warm lesson: prefer isolated node --test', scope: 'team' },
    });
    const workDir = path.join(tmp, '.worklogs', 'feat-warm');
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'warm.js'), 'module.exports = 1;\n');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({
        work_id: 'feat-warm',
        current_state: 'completed',
        task: 'warm organic ingest',
        history: [
          { actor: 'engineer', from: 'validation', to: 'pr-creation' },
          { actor: 'user', from: 'pr-creation', to: 'completed' },
        ],
      })
    );
    fs.writeFileSync(path.join(workDir, 'implementation.md'), '# Implementation\n\n1. `src/warm.js`\n\n```bash\nnpm test\n```\n');
    const warm2 = await warmChatMemory({ projectRoot: tmp, pluginRoot, limit: 4 });
    assert.ok(warm2.team.events >= 1);
    assert.ok(warm2.organic.work_items >= 1);
    assert.ok(warm2.project_skills.skills >= 0);

    const { openOrCreateDatabase, closeDatabase } = require('../scripts/lib/memory/graph-store.cjs');
    const { loadMergedMemoryConfig, sqlitePathForProject } = require('../scripts/lib/memory/config.cjs');
    const sqlitePath = sqlitePathForProject(loadMergedMemoryConfig(pluginRoot, tmp), tmp);
    const { db } = await openOrCreateDatabase(sqlitePath);
    const stmt = db.prepare("SELECT body FROM chunks WHERE work_id = 'team' LIMIT 5");
    let teamHits = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (String(row.body || '').includes('isolated node --test')) teamHits++;
    }
    stmt.free();
    closeDatabase(db);
    assert.ok(teamHits >= 1, 'team sync events should be in project memory graph');

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
