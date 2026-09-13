'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runMemoryScopeIngest } = require('../scripts/ingest-memory-scopes.cjs');
const { scaffoldProjectSkillFromRitual } = require('../scripts/lib/skills/project-skills.cjs');
const { openOrCreateDatabase, closeDatabase } = require('../scripts/lib/memory/graph-store.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('ingest-memory-scopes', () => {
  it('indexes project-local skills into memory graph', async () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'ing-mem-'));
    scaffoldProjectSkillFromRitual({
      projectRoot: tmpProj,
      skillName: 'team-lint',
      verifyCommand: 'npm run team-lint',
    });

    const r = await runMemoryScopeIngest({
      projectRoot: tmpProj,
      pluginRoot,
      skipSessions: true,
    });

    assert.equal(r.ok, true);
    assert.equal(r.project_skills.skills, 1);
    assert.equal(r.project_skills.chunks, 1);

    const { db } = await openOrCreateDatabase(r.project_skills.sqlitePath);
    const stmt = db.prepare("SELECT body FROM chunks WHERE path LIKE '%team-lint%'");
    let hits = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject();
      if (String(row.body || '').includes('team-lint')) hits++;
    }
    stmt.free();
    closeDatabase(db);
    assert.equal(hits, 1);

    fs.rmSync(tmpProj, { recursive: true, force: true });
  });
});
