'use strict';

/**
 * Deterministic offline skill invoke probe (AE-029b / PD-9).
 * Argv: <SKILL.md> <manifest.json> <expected-digest>
 * No shell; no network; exits non-zero on digest/manifest failure.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');

function fail(code, message) {
  process.stderr.write(String(message || code));
  process.exit(code);
}

const mdPath = process.argv[2];
const manPath = process.argv[3];
const expected = String(process.argv[4] || '')
  .trim()
  .toLowerCase();

if (!mdPath || !manPath || !expected) fail(1, 'ARGV_INVALID');
if (!/^[a-f0-9]{64}$/.test(expected)) fail(1, 'DIGEST_INVALID');

let raw;
let man;
try {
  raw = fs.readFileSync(mdPath, 'utf8');
  man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
} catch (err) {
  fail(1, err && err.message ? err.message : 'READ_FAILED');
}

let body = raw;
if (raw.startsWith('---\n')) {
  const end = raw.indexOf('\n---\n', 4);
  body = end === -1 ? raw : raw.slice(end + 5);
}
const dig = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
if (dig !== expected) fail(2, 'DIGEST_MISMATCH');
if (!man || typeof man !== 'object' || Array.isArray(man)) fail(3, 'MANIFEST_INVALID');
if (!man.name || !Array.isArray(man.permissions)) fail(3, 'MANIFEST_INVALID');

process.stdout.write(
  JSON.stringify({
    ok: true,
    skill: man.name,
    digest: dig,
    version: man.version || null,
  })
);
process.exit(0);
