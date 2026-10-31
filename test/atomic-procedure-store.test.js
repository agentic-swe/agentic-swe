'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { writeJsonAtomic } = require('../scripts/lib/descent/atomic-json.cjs');
const { saveStore, loadStore } = require('../scripts/lib/descent/promotion.cjs');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('writeJsonAtomic replaces procedures.json and removes the temp file', () => {
  const dir = tmpDir('ae-r16-');
  const file = path.join(dir, 'procedures.json');
  writeJsonAtomic(file, { procedures: [{ id: 'a' }] });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { procedures: [{ id: 'a' }] });
  assert.equal(fs.readdirSync(dir).some((name) => name.endsWith('.tmp')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a stringify failure leaves the previous procedures file intact', () => {
  const dir = tmpDir('ae-r16-');
  const file = path.join(dir, 'procedures.json');
  fs.writeFileSync(file, '{"procedures":[{"id":"kept"}]}\n');
  const circular = {};
  circular.self = circular;
  assert.throws(() => writeJsonAtomic(file, circular), TypeError);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"procedures":[{"id":"kept"}]}\n');
  assert.equal(fs.readdirSync(dir).some((name) => name.endsWith('.tmp')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('saveStore is what loadStore reads back', () => {
  const dir = tmpDir('ae-r16-');
  saveStore(dir, { procedures: [{ fingerprint: 'fp', tier: 'L0' }] });
  assert.equal(loadStore(dir).procedures[0].tier, 'L0');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a concurrent reader never parses a partial procedures file', async () => {
  const dir = tmpDir('ae-r16-race-');
  const file = path.join(dir, 'procedures.json');
  fs.writeFileSync(file, '{"procedures":[]}\n');
  const helper = path.join(__dirname, '..', 'scripts', 'lib', 'descent', 'atomic-json.cjs');
  const writer = spawn(process.execPath, ['-e', `
    const { writeJsonAtomic } = require(${JSON.stringify(helper)});
    const file = ${JSON.stringify(file)};
    for (let i = 0; i < 40; i++) {
      writeJsonAtomic(file, {
        procedures: Array.from({ length: 120 }, (_, n) => ({ n, i, pad: 'x'.repeat(160) })),
      }, { trailingNewline: true });
    }
  `], { stdio: ['ignore', 'ignore', 'pipe'] });
  const reader = spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    const file = ${JSON.stringify(file)};
    const end = Date.now() + 800;
    let n = 0;
    while (Date.now() < end) {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      n++;
    }
    process.stdout.write(String(n));
  `], { stdio: ['ignore', 'pipe', 'pipe'] });

  const [writerCode, readerResult] = await Promise.all([
    new Promise((resolve) => writer.on('exit', (code) => resolve(code))),
    new Promise((resolve) => {
      let out = '';
      let err = '';
      reader.stdout.on('data', (chunk) => { out += chunk; });
      reader.stderr.on('data', (chunk) => { err += chunk; });
      reader.on('exit', (code) => resolve({ code, out, err }));
    }),
  ]);

  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(writerCode, 0);
  assert.equal(readerResult.code, 0, readerResult.err);
  assert.ok(Number(readerResult.out) > 0);
});
