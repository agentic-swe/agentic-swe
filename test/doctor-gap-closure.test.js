'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspect } = require('../scripts/doctor.cjs');
const { verifyCriticalPackFiles } = require('../scripts/lib/doctor/verify-pack.cjs');
const { summarizeRedactionHits } = require('../scripts/lib/hooks/redaction-summary.cjs');
const { writeHookReceipt } = require('../scripts/lib/hooks/hook-receipt.cjs');

const packRoot = path.resolve(__dirname, '..');

describe('doctor gap closure', () => {
  it('includes muscle_memory and redaction in inspect JSON shape', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-gap-'));
    const result = inspect({ target: tmp }, { packRoot, home: tmp });
    assert.ok(result.muscle_memory);
    assert.equal(typeof result.muscle_memory.ok, 'boolean');
    assert.ok(result.redaction);
    assert.equal(typeof result.redaction.total, 'number');
    assert.ok(result.checks.some((c) => c.name === 'Muscle memory'));
    assert.ok(result.checks.some((c) => c.name === 'Redaction hits (recent hooks)'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('verify-pack succeeds against this pack root', () => {
    const v = verifyCriticalPackFiles(packRoot);
    assert.equal(v.ok, true, `missing: ${(v.missing || []).join(', ')}`);
    const result = inspect({ target: packRoot, verifyPack: true }, { packRoot, home: packRoot });
    assert.equal(result.pack_verify.ok, true);
    assert.ok(result.ok);
  });

  it('summarizeRedactionHits reads receipt totals', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-sum-'));
    writeHookReceipt({
      projectRoot: tmp,
      hook: 'session-capture',
      ok: true,
      redaction_hits: 2,
      steps: { distill: { redaction_hits: 1 } },
    });
    const sum = summarizeRedactionHits(tmp);
    assert.equal(sum.total, 3);
    assert.equal(sum.receipts_with_hits, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
