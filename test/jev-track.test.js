'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runTrackHint } = require('../scripts/jev-track-hint.cjs');

const pluginRoot = path.join(__dirname, '..');

function workDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-track-'));
  const state = {
    current_state: 'lean-track-check',
    task: 'Add retry logic',
    pipeline: { track: null, track_recommendation: { track: 'lean', confidence: 'low' } },
  };
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'feasibility.md'), 'Localized retry helper in one module.\n');
  return dir;
}

function response(choice, confidence, nouls) {
  return {
    ok: true,
    json: async () => ({
      model: 'jev-1.13.0',
      answers: {
        track: {
          type: 'choice',
          choice,
          confidence,
          probabilities: { lean: 0.2, standard: 0.7, rigorous: 0.1 },
        },
        security_sensitive: { type: 'noul', noul: nouls.security_sensitive },
        schema_or_migration: { type: 'noul', noul: nouls.schema_or_migration },
        multi_module: { type: 'noul', noul: nouls.multi_module },
      },
      usage: { input_tokens: 20, output_tokens: 4 },
    }),
  };
}

describe('jev track hint', () => {
  it('writes jev_track and leaves the authoritative track fields unchanged', async () => {
    const dir = workDir();
    const code = await runTrackHint({
      pluginRoot,
      projectRoot: dir,
      workDir: dir,
      env: { TYPESAFE_API_KEY: 'secret-key' },
      fetchImpl: async () => response('standard', 0.91, {
        security_sensitive: 0.1,
        schema_or_migration: 0.05,
        multi_module: 0.2,
      }),
    });
    assert.strictEqual(code, 0);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    assert.strictEqual(state.pipeline.track, null);
    assert.deepStrictEqual(state.pipeline.track_recommendation, { track: 'lean', confidence: 'low' });
    assert.strictEqual(state.pipeline.jev_track.choice, 'standard');
    assert.strictEqual(state.pipeline.jev_track.skipped, null);
    assert.strictEqual(state.pipeline.jev_track.caution, null);
    const audit = fs.readFileSync(path.join(dir, 'audit.log'), 'utf8');
    assert.match(audit, /action=track/);
    assert.match(audit, /reason=ok/);
    assert.strictEqual(audit.includes('secret-key'), false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('falls back on low confidence and flags lean plus a high risk noul', async () => {
    const lowDir = workDir();
    await runTrackHint({
      pluginRoot,
      projectRoot: lowDir,
      workDir: lowDir,
      env: { TYPESAFE_API_KEY: 'secret-key' },
      fetchImpl: async () => response('rigorous', 0.42, {
        security_sensitive: 0.2,
        schema_or_migration: 0.2,
        multi_module: 0.2,
      }),
    });
    const low = JSON.parse(fs.readFileSync(path.join(lowDir, 'state.json'), 'utf8'));
    assert.strictEqual(low.pipeline.track, null);
    assert.strictEqual(low.pipeline.jev_track.skipped, 'low_confidence');
    assert.strictEqual(low.pipeline.jev_track.fallback, 'heuristic+atr');
    const lowAudit = fs.readFileSync(path.join(lowDir, 'audit.log'), 'utf8').trim().split('\n');
    assert.strictEqual(lowAudit.length, 1);
    assert.match(lowAudit[0], /reason=low_confidence/);

    const cautionDir = workDir();
    await runTrackHint({
      pluginRoot,
      projectRoot: cautionDir,
      workDir: cautionDir,
      env: { TYPESAFE_API_KEY: 'secret-key' },
      fetchImpl: async () => response('lean', 0.93, {
        security_sensitive: 0.91,
        schema_or_migration: 0.1,
        multi_module: 0.1,
      }),
    });
    const caution = JSON.parse(fs.readFileSync(path.join(cautionDir, 'state.json'), 'utf8'));
    assert.strictEqual(caution.pipeline.track, null);
    assert.strictEqual(caution.pipeline.jev_track.choice, 'lean');
    assert.strictEqual(caution.pipeline.jev_track.caution, 'risk nouls argue against lean');
    fs.rmSync(lowDir, { recursive: true, force: true });
    fs.rmSync(cautionDir, { recursive: true, force: true });
  });

  it('records a missing key and does not change the track', async () => {
    const dir = workDir();
    const before = fs.readFileSync(path.join(dir, 'state.json'), 'utf8');
    const code = await runTrackHint({
      pluginRoot,
      projectRoot: dir,
      workDir: dir,
      env: {},
      fetchImpl: async () => {
        throw new Error('network');
      },
    });
    assert.strictEqual(code, 0);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    assert.strictEqual(state.pipeline.track, null);
    assert.deepStrictEqual(
      state.pipeline.track_recommendation,
      JSON.parse(before).pipeline.track_recommendation
    );
    assert.strictEqual(state.pipeline.jev_track.skipped, 'missing_key');
    assert.strictEqual(state.pipeline.jev_track.fallback, 'heuristic+atr');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
