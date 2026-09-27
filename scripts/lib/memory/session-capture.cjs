'use strict';

const crypto = require('node:crypto');
const { scoreCapture, acceptsPattern } = require('./evidence-score.cjs');

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

function pushNode(nodes, fields) {
  nodes.push({
    id: fields.id,
    kind: fields.kind,
    label: fields.label.slice(0, 120),
    body: fields.body,
    score: fields.score,
    evidence: fields.evidence,
  });
}

/**
 * Distill a session transcript chunk into typed memory nodes.
 * Nodes are kept only when evidence converges. A long transcript with no
 * decision, lesson, runnable command, or repo path is not stored.
 * @param {{ text: string, workId?: string|null, source?: string }} input
 * @returns {{ nodes: Array<{ id: string, kind: string, label: string, body: string, score?: number, evidence?: string[] }>, redaction_hits: number }}
 */
function distillSessionChunk(input) {
  const { redacted, hits } = redactSecrets(String(input.text || ''));
  if (hits > 0 && !redacted.trim()) {
    return { nodes: [], redaction_hits: hits, blocked: true };
  }
  const nodes = [];
  const scored = scoreCapture(redacted);
  const base = crypto.createHash('sha256').update(redacted.slice(0, 4000)).digest('hex').slice(0, 12);
  const work = input.workId ? `work:${input.workId}` : 'session';
  const body = redacted.slice(0, 2000);

  if (scored.decision && scored.score >= 0.45) {
    pushNode(nodes, {
      id: `${work}:decision:${base}`,
      kind: 'decision',
      label: scored.decision,
      body,
      score: scored.score,
      evidence: scored.evidence,
    });
  }
  if (scored.lesson && scored.score >= 0.45) {
    pushNode(nodes, {
      id: `${work}:lesson:${base}`,
      kind: 'lesson',
      label: scored.lesson,
      body,
      score: scored.score,
      evidence: scored.evidence,
    });
  }
  if (!nodes.length && acceptsPattern(scored)) {
    pushNode(nodes, {
      id: `${work}:pattern:${base}`,
      kind: 'pattern',
      label: redacted.trim(),
      body,
      score: scored.score,
      evidence: scored.evidence,
    });
  }
  return { nodes, redaction_hits: hits, blocked: false, score: scored.score, evidence: scored.evidence };
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
    stmt.run([
      n.id,
      n.kind,
      null,
      n.label,
      JSON.stringify({ body: n.body, score: n.score, evidence: n.evidence || [] }),
    ]);
    stmt.free();
  }
}

module.exports = {
  redactSecrets,
  distillSessionChunk,
  upsertTypedNodes,
};
