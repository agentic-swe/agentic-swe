'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  loadBenchmarkFixture,
  runRoutingBenchmark,
  scoreQuery,
} = require('../scripts/lib/skills/routing-benchmark.cjs');

const root = path.join(__dirname, '..');

describe('AE-026b skill routing benchmark', () => {
  it('frozen fixture loads and rejects blank/null expected skills', () => {
    const { data } = loadBenchmarkFixture(root);
    assert.equal(data.version, 1);
    assert.ok(data.queries.length >= 10);
    assert.equal(typeof data.thresholds.hit_at_1, 'number');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae026b-bad-'));
    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(
      bad,
      JSON.stringify({
        version: 1,
        thresholds: {
          hit_at_1: 0.5,
          hit_at_3: 0.5,
          precision_at_k: 0.1,
          recall_at_k: 0.5,
          k: 5,
        },
        queries: [{ id: 'x', query: 'check budget', expected: ['', null] }],
      })
    );
    assert.throws(() => loadBenchmarkFixture(root, bad), /non-blank|expected/);
    fs.writeFileSync(bad, '{not-json');
    assert.throws(() => loadBenchmarkFixture(root, bad), /corrupt JSON/);
    fs.writeFileSync(
      bad,
      JSON.stringify({
        version: 1,
        thresholds: {
          hit_at_1: 0.5,
          hit_at_3: 0.5,
          precision_at_k: 0.1,
          recall_at_k: 0.5,
          k: 5,
        },
        queries: [{ id: 'x', query: '   ', expected: ['check'] }],
      })
    );
    assert.throws(() => loadBenchmarkFixture(root, bad), /non-blank/);
  });

  it('scoreQuery hit@k / precision / recall are deterministic', () => {
    const s = scoreQuery(['check', 'work', 'goal'], ['check'], 5);
    assert.equal(s.hit_at_1, true);
    assert.equal(s.hit_at_3, true);
    assert.equal(s.precision, 1 / 3);
    assert.equal(s.recall, 1);
    const miss = scoreQuery(['work', 'goal'], ['check'], 3);
    assert.equal(miss.hit_at_1, false);
    assert.equal(miss.hit_at_3, false);
    assert.equal(miss.precision, 0);
    assert.equal(miss.recall, 0);
    // Empty predicted must not divide-by-zero / skip
    const empty = scoreQuery([], ['check'], 5);
    assert.equal(empty.precision, 0);
    assert.equal(empty.recall, 0);
    assert.equal(empty.hit_at_1, false);
  });

  it('offline benchmark meets documented thresholds (CI gate)', () => {
    let fetches = 0;
    const report = runRoutingBenchmark({
      pluginRoot: root,
      transport: {
        fetch: async () => {
          fetches += 1;
          return { ok: true };
        },
      },
    });
    assert.equal(fetches, 0, 'PD-9: no network in benchmark');
    assert.equal(report.offline, true);
    assert.equal(report.paid_llm, false);
    assert.equal(
      report.pass,
      true,
      `benchmark below threshold: ${JSON.stringify(report.failures)} metrics=${JSON.stringify(report.metrics)}`
    );
    assert.ok(report.metrics.hit_at_1 >= report.thresholds.hit_at_1);
    assert.ok(report.metrics.hit_at_3 >= report.thresholds.hit_at_3);
    assert.ok(report.metrics.precision_at_k >= report.thresholds.precision_at_k);
    assert.ok(report.metrics.recall_at_k >= report.thresholds.recall_at_k);
  });

  it('CLI exits non-zero when threshold is raised above achievable', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ae026b-thresh-'));
    const fixture = path.join(dir, 'fixture.json');
    const base = loadBenchmarkFixture(root).data;
    fs.writeFileSync(
      fixture,
      JSON.stringify({
        ...base,
        thresholds: {
          ...base.thresholds,
          hit_at_1: 1.01,
        },
      })
    );
    const r = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/skill-route-bench.cjs'), '--fixture', fixture, '--plugin-root', root],
      { encoding: 'utf8', env: process.env }
    );
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /hit@1|pass=false|failures/i);
  });

  it('CLI exits 0 on the committed fixture', () => {
    const r = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/skill-route-bench.cjs'), '--plugin-root', root],
      { encoding: 'utf8', env: process.env }
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /hit@1=/);
    assert.match(r.stdout, /precision@k=/);
    assert.match(r.stdout, /pass=true/);
  });
});
