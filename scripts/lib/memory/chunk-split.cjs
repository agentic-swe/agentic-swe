'use strict';

const crypto = require('node:crypto');

/**
 * Split markdown on heading lines (`#` … `######` at line start).
 * Oversized sections are split with `splitBodyMax`.
 * @param {string} content
 * @param {number} maxChars
 * @returns {{ startLine: number, endLine: number, body: string }[]}
 */
function chunkMarkdown(content, maxChars) {
  const lines = content.split(/\r?\n/);
  const h = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*#{1,6}\s/.test(lines[i])) h.push(i);
  }

  /** @type {{ a: number, b: number }[]} */
  const parts = [];
  if (h.length === 0) {
    const body = lines.join('\n').trimEnd();
    if (body) parts.push({ a: 0, b: lines.length });
  } else {
    if (h[0] > 0) parts.push({ a: 0, b: h[0] });
    for (let i = 0; i < h.length; i++) {
      parts.push({ a: h[i], b: i + 1 < h.length ? h[i + 1] : lines.length });
    }
  }

  /** @type {{ startLine: number, endLine: number, body: string }[]} */
  const out = [];
  for (const { a, b } of parts) {
    const body = lines.slice(a, b).join('\n').trimEnd();
    if (!body) continue;
    out.push(...splitBodyMax(body, maxChars, a + 1));
  }
  return out;
}

/**
 * @param {string} body
 * @param {number} maxChars
 * @param {number} startLine 1-based
 */
function splitBodyMax(body, maxChars, startLine) {
  if (body.length <= maxChars) {
    const n = body.split('\n').length;
    return [{ startLine, endLine: startLine + n - 1, body }];
  }
  const chunks = [];
  let offset = 0;
  let line = startLine;
  while (offset < body.length) {
    let end = Math.min(offset + maxChars, body.length);
    if (end < body.length) {
      const lastNl = body.lastIndexOf('\n', end - 1);
      if (lastNl > offset) end = lastNl + 1;
    }
    const piece = body.slice(offset, end).replace(/\n+$/, '');
    const nl = piece.split('\n').length;
    chunks.push({
      startLine: line,
      endLine: line + nl - 1,
      body: piece,
    });
    line += nl;
    offset = end;
    while (offset < body.length && body[offset] === '\n') offset++;
  }
  return chunks;
}

/**
 * @param {string} pathPosix
 * @param {number} startLine
 * @param {number} endLine
 * @param {string} body
 */
function makeChunkId(pathPosix, startLine, endLine, body) {
  const h = crypto.createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 12);
  return `c:${h}:${pathPosix}:${startLine}:${endLine}`;
}

/**
 * @param {string} pathPosix
 * @returns {string|null}
 */
function workIdFromPath(pathPosix) {
  const m = pathPosix.match(/^\.worklogs\/([^/]+)\//);
  return m ? m[1] : null;
}

module.exports = {
  chunkMarkdown,
  makeChunkId,
  workIdFromPath,
};
