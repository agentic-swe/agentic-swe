'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const pluginRoot = path.resolve(__dirname, '..');
const fixture = path.join(__dirname, 'fixtures', 'transcript-cost-sample.jsonl');

describe('session-capture self-evolution chain', () => {
  let tmp;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sess-cap-'));
    fs.mkdirSync(path.join(tmp, '.worklogs', 'w1'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, '.worklogs', 'w1', 'state.json'),
      JSON.stringify({ work_id: 'w1', current_state: 'validation', budget: {} }, null, 2)
    );
    const richTranscript = [
      '{"type":"user","message":{"role":"user","content":"Please run npm test to verify the retry logic implementation."}}',
      '{"type":"assistant","model":"claude-sonnet-4-20250514","message":{"role":"assistant","content":"I will run npm test and node scripts/verify-sanity.js to validate the changes before opening a PR."},"usage":{"input_tokens":100,"output_tokens":50}}',
    ].join('\n');
    fs.writeFileSync(path.join(tmp, 'session.jsonl'), richTranscript, 'utf8');
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('session-capture indexes chunks and triggers evolve-cycle', () => {
    const r = spawnSync(
      process.execPath,
      [
        path.join(pluginRoot, 'scripts/session-capture.cjs'),
        '--project-root',
        tmp,
        '--plugin-root',
        pluginRoot,
        '--transcript-path',
        path.join(tmp, 'session.jsonl'),
        '--json',
      ],
      { encoding: 'utf8', cwd: tmp, env: { ...process.env, AGENTIC_SWE_EVOLVE_ON_STOP: '1' } }
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const payload = JSON.parse(r.stdout.trim());
    assert.equal(payload.ok, true);
    assert.ok(payload.chunks >= 1, 'expected transcript chunks indexed');

    const sqlitePath = path.join(tmp, '.agentic-swe', 'memory.sqlite');
    assert.ok(fs.existsSync(sqlitePath), 'memory.sqlite should exist');
  });

  it('evolve-cycle mines procedures from indexed chunks', async () => {
    const cap = spawnSync(
      process.execPath,
      [
        path.join(pluginRoot, 'scripts/session-capture.cjs'),
        '--project-root',
        tmp,
        '--plugin-root',
        pluginRoot,
        '--transcript-path',
        path.join(tmp, 'session.jsonl'),
      ],
      { encoding: 'utf8', cwd: tmp }
    );
    assert.equal(cap.status, 0);

    const { runEvolveCycle } = require('../scripts/evolve-cycle.cjs');
    const mine = await runEvolveCycle({ projectRoot: tmp, pluginRoot, limit: 10 });
    assert.equal(mine.ok, true);
    assert.ok(mine.procedures_mined >= 0);
    assert.ok(mine.team_events_ingested >= 1, 'evolve-cycle should ingest team sync events into sqlite');
  });
});

describe('memory-prime after session ingest', () => {
  it('ingest + prime returns bounded context', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-prime-'));
    const { ingestTranscripts } = require('../scripts/lib/memory/session-ingest.cjs');
    const { runMemoryIndex } = require('../scripts/lib/memory/memory-pipeline.cjs');

    await runMemoryIndex({ projectRoot: tmp, pluginRoot, skipGraph: true });
    await ingestTranscripts({
      projectRoot: tmp,
      pluginRoot,
      transcriptPaths: [fixture],
    });

    const prime = spawnSync(
      process.execPath,
      [
        path.join(pluginRoot, 'scripts/memory-prime.cjs'),
        '--project-root',
        tmp,
        '--plugin-root',
        pluginRoot,
        '--query',
        'npm test verify',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(prime.status, 0, prime.stderr);
    assert.ok(prime.stdout.length > 0);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
