'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('node:path');
const { buildFingerprint } = require('../scripts/lib/descent/fingerprint.cjs');
const { replayProcedure } = require('../scripts/lib/descent/replay.cjs');
const { tryDescent } = require('../scripts/lib/descent/try-descent.cjs');
const { promoteOrDemote, tierHitRates } = require('../scripts/lib/descent/promotion.cjs');
const { normalizeModelTier, ALLOWED_MODELS } = require('../scripts/lib/catalog/parse-frontmatter.cjs');

describe('descent fingerprint', () => {
  it('same file-set + verify produces stable fingerprint', () => {
    const a = buildFingerprint({
      files: ['package.json', 'CHANGELOG.md'],
      verifyCommand: 'npm run version:check',
    });
    const b = buildFingerprint({
      files: ['CHANGELOG.md', 'package.json'],
      verifyCommand: 'npm run version:check',
    });
    assert.strictEqual(a, b);
  });

  it('different failure signature yields different fingerprint', () => {
    const a = buildFingerprint({ files: ['a.js'], verifyCommand: 'npm test', failureSignature: 'exit 1' });
    const b = buildFingerprint({ files: ['a.js'], verifyCommand: 'npm test', failureSignature: 'timeout' });
    assert.notStrictEqual(a, b);
  });
});

describe('descent replay', () => {
  const root = path.join(__dirname, '..');

  it('replays READ_FILE + RUN verify successfully', () => {
    const r = replayProcedure({
      projectRoot: root,
      procedure: {
        actions: [{ type: 'READ_FILE', path: 'package.json' }],
        verify: [{ type: 'RUN', command: 'node -e "process.exit(0)"' }],
      },
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.tier, 'L0');
  });

  it('escalates on verify failure', () => {
    const r = replayProcedure({
      projectRoot: root,
      procedure: {
        actions: [],
        verify: [{ type: 'RUN', command: 'node -e "process.exit(1)"' }],
      },
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.escalate, true);
    assert.strictEqual(r.tier, 'L3');
  });
});

describe('tryDescent lookup order', () => {
  const tmp = path.join(__dirname, '_tmp-try-descent');

  it('prefers fingerprint match over verify-only match when files provided', () => {
    fs.mkdirSync(tmp, { recursive: true });
    const sharedVerify = 'npm test';
    const fpPass = buildFingerprint({ files: ['mined-trivial-pass'], verifyCommand: sharedVerify });
    const fpFail = buildFingerprint({ files: ['mined-trivial-fail'], verifyCommand: sharedVerify });

    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: fpPass,
      procedure: {
        actions: [{ type: 'RUN', command: 'node -e "process.exit(0)"' }],
        verify: [{ type: 'RUN', command: 'node -e "process.exit(0)"' }],
      },
      evalPassed: true,
      humanApproved: true,
    });
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: fpFail,
      procedure: {
        actions: [{ type: 'RUN', command: 'node -e "process.exit(1)"' }],
        verify: [{ type: 'RUN', command: 'node -e "process.exit(1)"' }],
      },
      evalPassed: true,
      humanApproved: true,
    });

    const passHit = tryDescent({ projectRoot: tmp, verifyCommand: sharedVerify, files: ['mined-trivial-pass'] });
    const failHit = tryDescent({ projectRoot: tmp, verifyCommand: sharedVerify, files: ['mined-trivial-fail'] });
    assert.strictEqual(passHit.ok, true);
    assert.strictEqual(failHit.ok, false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('descent promotion', () => {
  const tmp = path.join(__dirname, '_tmp-promotion');

  it('promotes to L0 after eval + human approval', () => {
    fs.mkdirSync(tmp, { recursive: true });
    const fp = buildFingerprint({ files: ['x.js'], verifyCommand: 'npm test' });
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: fp,
      procedure: { actions: [] },
      evalPassed: true,
      humanApproved: true,
    });
    const rates = tierHitRates(tmp);
    assert.ok(rates.L0 >= 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('demotes after two verify failures', () => {
    fs.mkdirSync(tmp, { recursive: true });
    const fp = buildFingerprint({ files: ['y.js'], verifyCommand: 'npm test' });
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: fp,
      procedure: { actions: [] },
      evalPassed: true,
      humanApproved: true,
    });
    promoteOrDemote({ projectRoot: tmp, fingerprint: fp, procedure: {}, evalPassed: false, verifyFailed: true });
    promoteOrDemote({ projectRoot: tmp, fingerprint: fp, procedure: {}, evalPassed: false, verifyFailed: true });
    const store = JSON.parse(fs.readFileSync(path.join(tmp, '.agentic-swe/procedures.json'), 'utf8'));
    const rec = store.procedures.find((p) => p.fingerprint === fp);
    assert.strictEqual(rec.tier, 'L1');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('model tier normalization', () => {
  it('maps legacy models to capability tiers', () => {
    assert.strictEqual(normalizeModelTier('sonnet'), 'balanced');
    assert.strictEqual(normalizeModelTier('opus'), 'heavy');
    assert.strictEqual(normalizeModelTier('haiku'), 'fast');
  });

  it('model-map config lists four tiers', () => {
    const map = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'config', 'model-map.claude-code.json'), 'utf8')
    );
    for (const t of ['fast', 'balanced', 'heavy', 'frontier']) {
      assert.ok(map.tiers[t], `missing tier ${t}`);
    }
    assert.ok(ALLOWED_MODELS.has('balanced'));
    for (const host of ['gemini', 'opencode']) {
      const hm = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'config', `model-map.${host}.json`), 'utf8')
      );
      for (const t of ['fast', 'balanced', 'heavy', 'frontier']) {
        assert.ok(hm.tiers[t], `${host} missing ${t}`);
      }
    }
  });
});
