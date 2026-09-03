'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildFleetMemoryBody, ingestFleetSubmissionMemory } = require('../scripts/lib/fleet/ingest-fleet-memory.cjs');
const { openOrCreateDatabase, closeDatabase } = require('../scripts/lib/memory/graph-store.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('ingestFleetSubmissionMemory', () => {
  it('indexes fleet submission into maintainer team memory graph', async () => {
    const submission = {
      project_root: '/tmp/consumer-a',
      fleet_evidence_class: 'maintainer_dogfood',
      git: { origin: 'https://example.com/repo.git', head: 'abc123' },
      evidence: {
        submission_readiness: {
          organic_live: 3,
          tier_totals_work_items: 3,
          portfolio_multiplier: 0.01,
        },
        procedures: { evaluated: 2, ritual_skills: ['team-lint'], verify_samples: ['npm test'] },
      },
    };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-mem-'));
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.copyFileSync(
      path.join(pluginRoot, 'config/memory.default.json'),
      path.join(tmp, 'config/memory.default.json')
    );
    const archivePath = path.join(tmp, 'bench', 'results', 'fleet-submissions', 'test-archive.json');
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.writeFileSync(archivePath, '{}');

    const body = buildFleetMemoryBody(submission, 'bench/results/fleet-submissions/test-archive.json');
    assert.match(body, /fleet_evidence_class: maintainer_dogfood/);
    assert.match(body, /organic_live: 3/);
    assert.match(body, /verify_samples: npm test/);

    const r = await ingestFleetSubmissionMemory({ submission, pluginRoot: tmp, archivePath });
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(tmp, '.agentic-swe', 'memory.sqlite')));

    const { db } = await openOrCreateDatabase(path.join(tmp, '.agentic-swe', 'memory.sqlite'));
    const row = db.exec(`SELECT body FROM chunks WHERE work_id='team' AND body LIKE '%fleet submission ingested%'`);
    closeDatabase(db);
    assert.ok(row.length > 0);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('syncArchivedFleetSubmissionsMemory indexes all archives', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-sync-'));
    const archiveDir = path.join(tmp, 'bench', 'results', 'fleet-submissions');
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.copyFileSync(
      path.join(pluginRoot, 'config/memory.default.json'),
      path.join(tmp, 'config/memory.default.json')
    );
    const submission = {
      project_root: '/tmp/consumer-sync',
      fleet_evidence_class: 'maintainer_dogfood',
      evidence: { submission_readiness: { organic_live: 3, portfolio_multiplier: 0.01 }, procedures: {} },
    };
    const archivePath = path.join(archiveDir, 'test-sync.json');
    fs.writeFileSync(archivePath, JSON.stringify(submission));

    const { syncArchivedFleetSubmissionsMemory } = require('../scripts/lib/fleet/ingest-fleet-memory.cjs');
    const r = await syncArchivedFleetSubmissionsMemory(tmp);
    assert.equal(r.ok, true);
    assert.equal(r.synced, 1);

    const { buildPrimeMarkdown } = require('../scripts/lib/memory/memory-prime.cjs');
    const md = await buildPrimeMarkdown({ projectRoot: tmp, pluginRoot: tmp, query: null });
    assert.match(md, /Fleet learnings/);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
