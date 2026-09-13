'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('node:path');
const { distillSessionChunk, redactSecrets } = require('../scripts/lib/memory/session-capture.cjs');
const { appendLocalEvent, mergeEvents, signEvent } = require('../scripts/lib/sync/git-sync.cjs');
const { buildStyleProfile } = require('../scripts/lib/memory/style-profile.cjs');

describe('session capture + redaction', () => {
  it('redacts api keys', () => {
    const r = redactSecrets('token=ghp_abcdefghijklmnopqrstuvwxyz1234567890');
    assert.ok(r.hits >= 1);
    assert.match(r.redacted, /REDACTED/);
  });

  it('distills decision nodes', () => {
    const d = distillSessionChunk({
      text: 'Decision: use work-engine for all transitions. Lesson: always run npm test.',
      workId: 'demo',
    });
    assert.ok(d.nodes.length >= 1);
    assert.ok(d.nodes.some((n) => n.kind === 'decision' || n.kind === 'lesson'));
  });
});

describe('git sync events', () => {
  const tmp = path.join(__dirname, '_tmp-sync');

  it('append + sign events locally', () => {
    fs.mkdirSync(tmp, { recursive: true });
    const f = appendLocalEvent({
      projectRoot: tmp,
      event: { kind: 'lesson', label: 'test', scope: 'team' },
      secret: 'test-secret',
    });
    assert.ok(fs.existsSync(f));
    const ev = JSON.parse(fs.readFileSync(f, 'utf8'));
    assert.strictEqual(ev.sig, signEvent({ ...ev, sig: undefined }, 'test-secret'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('mergeEvents prefers newer ts', () => {
    const merged = mergeEvents(
      [{ id: 'a', ts: '2026-01-01T00:00:00Z', label: 'old' }],
      [{ id: 'a', ts: '2026-02-01T00:00:00Z', label: 'new' }]
    );
    assert.strictEqual(merged[0].label, 'new');
  });
});

describe('style profile', () => {
  it('builds constraints with provenance', () => {
    const p = buildStyleProfile({
      projectRoot: path.join(__dirname, '..'),
      pluginRoot: path.join(__dirname, '..'),
    });
    assert.ok(p.constraints.length >= 3);
    assert.ok(p.constraints.every((c) => c.provenance && c.text));
  });
});
