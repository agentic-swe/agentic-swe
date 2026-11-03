'use strict';

/**
 * Token shingles + Jaccard for provenance similarity checks.
 * Bodies only (callers strip frontmatter). No upstream text is stored — only hashes.
 */

const crypto = require('node:crypto');

const DEFAULT_SHINGLE_SIZE = 5;

/**
 * @param {string} text
 * @returns {string[]}
 */
function normalizeTokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 2);
}

/**
 * @param {string[]} tokens
 * @param {number} k
 * @returns {string[]}
 */
function tokenShingles(tokens, k = DEFAULT_SHINGLE_SIZE) {
  if (tokens.length < k) {
    if (tokens.length === 0) return [];
    return [tokens.join(' ')];
  }
  const out = [];
  for (let i = 0; i <= tokens.length - k; i++) {
    out.push(tokens.slice(i, i + k).join(' '));
  }
  return out;
}

/**
 * Stable 32-bit hash of a shingle string (first 4 bytes of sha256).
 * @param {string} shingle
 * @returns {number}
 */
function hashShingle(shingle) {
  const buf = crypto.createHash('sha256').update(shingle, 'utf8').digest();
  return buf.readUInt32BE(0);
}

/**
 * @param {string} body
 * @param {{ shingleSize?: number }} [opts]
 * @returns {number[]} sorted unique uint32 hashes
 */
function bodyShingleHashes(body, opts = {}) {
  const k = opts.shingleSize || DEFAULT_SHINGLE_SIZE;
  const tokens = normalizeTokens(body);
  const shingles = tokenShingles(tokens, k);
  const set = new Set();
  for (const s of shingles) set.add(hashShingle(s));
  return [...set].sort((a, b) => a - b);
}

/**
 * @param {number[]} hashes
 * @returns {string} base64 of packed big-endian uint32s
 */
function packHashes(hashes) {
  const buf = Buffer.allocUnsafe(hashes.length * 4);
  for (let i = 0; i < hashes.length; i++) buf.writeUInt32BE(hashes[i] >>> 0, i * 4);
  return buf.toString('base64');
}

/**
 * @param {string} b64
 * @returns {Set<number>}
 */
function unpackHashes(b64) {
  const buf = Buffer.from(String(b64 || ''), 'base64');
  const set = new Set();
  for (let i = 0; i + 4 <= buf.length; i += 4) {
    set.add(buf.readUInt32BE(i));
  }
  return set;
}

/**
 * @param {Iterable<number>} a
 * @param {Iterable<number>} b
 * @returns {number} Jaccard in [0,1]
 */
function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a);
  const B = b instanceof Set ? b : new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) {
    if (B.has(x)) inter++;
  }
  return inter / (A.size + B.size - inter);
}

/**
 * @param {string} body
 * @returns {string} sha256 hex of normalized body (LF, trimmed)
 */
function bodyContentHash(body) {
  const norm = String(body || '').replace(/\r\n/g, '\n').trim() + '\n';
  return crypto.createHash('sha256').update(norm, 'utf8').digest('hex');
}

module.exports = {
  DEFAULT_SHINGLE_SIZE,
  normalizeTokens,
  tokenShingles,
  hashShingle,
  bodyShingleHashes,
  packHashes,
  unpackHashes,
  jaccard,
  bodyContentHash,
};
