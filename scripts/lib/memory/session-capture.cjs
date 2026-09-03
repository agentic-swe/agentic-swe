'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|passwd|authorization)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+=]{8,}/gi,
  /sk-[A-Za-z0-9]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----/g,
];

/**
 * @param {string} text
 * @returns {{ redacted: string, hits: number }}
 */
function redactSecrets(text) {
  let redacted = text;
  let hits = 0;
  for (const re of SECRET_PATTERNS) {
    redacted = redacted.replace(re, (m) => {
      hits++;
      return '[REDACTED]';
    });
  }
  return { redacted, hits };
}

/**
 * Distill a session transcript chunk into typed memory nodes.
 * @param {{ text: string, workId?: string|null, source?: string }} input
 * @returns {{ nodes: Array<{ id: string, kind: string, label: string, body: string }>, redaction_hits: number }}
 */
function distillSessionChunk(input) {
  const { redacted, hits } = redactSecrets(String(input.text || ''));
  if (hits > 0 && !redacted.trim()) {
    return { nodes: [], redaction_hits: hits, blocked: true };
  }
  const nodes = [];
  const base = crypto.createHash('sha256').update(redacted.slice(0, 4000)).digest('hex').slice(0, 12);
  const work = input.workId ? `work:${input.workId}` : 'session';

  const decisionMatch = redacted.match(/(?:decided|decision|chosen|we will)\s*[:\-]?\s*(.{20,200})/i);
  if (decisionMatch) {
    nodes.push({
      id: `${work}:decision:${base}`,
      kind: 'decision',
      label: decisionMatch[1].trim().slice(0, 120),
      body: redacted.slice(0, 2000),
    });
  }
  const lessonMatch = redacted.match(/(?:lesson|learned|takeaway)\s*[:\-]?\s*(.{20,200})/i);
  if (lessonMatch) {
    nodes.push({
      id: `${work}:lesson:${base}`,
      kind: 'lesson',
      label: lessonMatch[1].trim().slice(0, 120),
      body: redacted.slice(0, 2000),
    });
  }
  if (!nodes.length && redacted.trim().length > 80) {
    nodes.push({
      id: `${work}:pattern:${base}`,
      kind: 'pattern',
      label: redacted.trim().slice(0, 120),
      body: redacted.slice(0, 2000),
    });
  }
  return { nodes, redaction_hits: hits, blocked: false };
}

/**
 * Persist distilled nodes into SQLite graph (upsert).
 * @param {*} db sql.js database
 * @param {Array<{ id: string, kind: string, label: string, body: string }>} nodes
 */
function upsertTypedNodes(db, nodes) {
  for (const n of nodes) {
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO nodes (id, kind, path, label, meta_json) VALUES (?, ?, ?, ?, ?)'
    );
    stmt.run([n.id, n.kind, null, n.label, JSON.stringify({ body: n.body })]);
    stmt.free();
  }
}

module.exports = {
  redactSecrets,
  distillSessionChunk,
  upsertTypedNodes,
};
