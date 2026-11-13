'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  SCHEMA_PATH,
  loadSchema,
  computeManifestDigest,
  validateEvalManifest,
  validateEvalManifestFile,
} = require('../scripts/lib/bench/eval-manifest.cjs');

const root = path.join(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures', 'eval-manifest');
const runnerPath = path.join(root, 'scripts', 'bench', 'run.cjs');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));
}

function runValidate(args) {
  return spawnSync(process.execPath, [runnerPath, 'validate', ...args], {
    encoding: 'utf8',
    cwd: root,
    env: { ...process.env, PATH: process.env.PATH },
  });
}

describe('AE-034a frozen eval manifest schema (ADR-013)', () => {
  it('schema file exists and forbids default_score', () => {
    assert.ok(fs.existsSync(SCHEMA_PATH));
    const schema = loadSchema();
    assert.match(schema.title, /Frozen Eval Manifest/);
    assert.equal(schema.properties.default_score, false);
    assert.deepEqual(schema.properties.pool.enum, ['dev', 'public', 'private']);
    assert.ok(schema.required.includes('manifest_digest'));
    assert.ok(schema.required.includes('cold_run_required'));
    assert.ok(schema.required.includes('retain_negatives'));
    assert.equal(schema.properties.retain_negatives.const, true);
  });

  it('valid fixture passes schema + digest check', () => {
    const manifest = readFixture('valid.json');
    const check = validateEvalManifest(manifest);
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.equal(check.digest, computeManifestDigest(manifest));
    assert.equal(manifest.pool, 'dev');
    assert.equal(manifest.cold_run_required, true);
    assert.equal(manifest.retain_negatives, true);
    assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'default_score'), false);
  });

  it('missing SHA fails with named path /tasks/0/content_sha256', () => {
    const manifest = readFixture('broken-missing-sha.json');
    const check = validateEvalManifest(manifest);
    assert.equal(check.ok, false);
    const joined = (check.errors || []).join('\n');
    assert.match(joined, /\/tasks\/0\/content_sha256/, joined);
  });

  it('unknown pool fails with named path /pool', () => {
    const manifest = readFixture('broken-unknown-pool.json');
    const check = validateEvalManifest(manifest);
    assert.equal(check.ok, false);
    const joined = (check.errors || []).join('\n');
    assert.match(joined, /\/pool\b/, joined);
  });

  it('presence of default_score fails with named path /default_score', () => {
    const manifest = readFixture('broken-default-score.json');
    const check = validateEvalManifest(manifest);
    assert.equal(check.ok, false);
    const joined = (check.errors || []).join('\n');
    assert.match(joined, /\/default_score\b/, joined);
  });

  it('mutable/unpinned task entry fails with named path /tasks/0/mutable', () => {
    const manifest = readFixture('broken-unpinned.json');
    const check = validateEvalManifest(manifest);
    assert.equal(check.ok, false);
    const joined = (check.errors || []).join('\n');
    assert.match(joined, /\/tasks\/0\/mutable\b/, joined);
  });

  it('local ollama marked sole_e8_proof=true fails (PD-41)', () => {
    const manifest = readFixture('valid.json');
    const local = {
      ...manifest,
      id: 'local-bad',
      model_provenance: {
        provider: 'ollama',
        model: 'llama3.2:1b',
        label: 'observed',
        sole_e8_proof: true,
      },
    };
    local.manifest_digest = computeManifestDigest(local);
    const check = validateEvalManifest(local);
    assert.equal(check.ok, false);
    assert.match((check.errors || []).join('\n'), /\/model_provenance\/sole_e8_proof/);
  });

  it('digest mismatch fails with named path /manifest_digest', () => {
    const manifest = {
      ...readFixture('valid.json'),
      manifest_digest: '0'.repeat(64),
    };
    const check = validateEvalManifest(manifest);
    assert.equal(check.ok, false);
    assert.match((check.errors || []).join('\n'), /\/manifest_digest\b/);
  });

  it('bench:validate --manifest passes on valid fixture and fails on broken', () => {
    const pass = runValidate(['--manifest', path.join(fixtures, 'valid.json')]);
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    assert.match(pass.stdout, /\[PASS\] eval-manifest valid\.json/);

    const fail = runValidate(['--manifest', path.join(fixtures, 'broken-default-score.json')]);
    assert.notEqual(fail.status, 0);
    assert.match(fail.stdout, /\[FAIL\] eval-manifest broken-default-score\.json/);
    assert.match(fail.stdout, /\/default_score/);
  });

  it('bench:validate --all includes committed bench/manifests and stays green', () => {
    const result = runValidate(['--all']);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /\[PASS\] eval-manifest dev-smoke\.json/);
    assert.match(result.stdout, /\[PASS\] eval-manifest public-holdout\.json/);
    assert.match(result.stdout, /All passed/);
  });

  it('validateEvalManifestFile reports path on missing file', () => {
    const missing = path.join(fixtures, 'does-not-exist.json');
    const check = validateEvalManifestFile(missing);
    assert.equal(check.ok, false);
    assert.equal(check.code, 'MANIFEST_MISSING');
  });
});
