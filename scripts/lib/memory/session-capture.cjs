'use strict';

const crypto = require('node:crypto');
const { scoreCapture, acceptsPattern } = require('./evidence-score.cjs');

const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|token|password|passwd|authorization)\s*[:=]\s*['"]?[A-Za-z0-9_\-./+=]{8,}/gi,
  /sk-[A-Za-z0-9]{20,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /(?:github_pat_|gho_|ghu_|ghs_|ghr_|glpat-)[A-Za-z0-9_\-]{20,}/g,
  /npm_[A-Za-z0-9]{36}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqp):\/\/\S+/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----/g,
];

const PROSE_SECRET =
  /((?:api[_-]?key|client[_-]?secret|secret|token|password|passwd)\s+is\s+)(\S+)/gi;

function looksLikeCredential(value) {
  if (value.length < 8) return false;
  if (/\d/.test(value) || /[-_]/.test(value) || value.length >= 20) return true;
  return false;
}

/**
 * @param {string} text
 * @returns {{ redacted: string, hits: number }}
 */
function redactSecrets(text) {
  let redacted = String(text ?? '');
  let hits = 0;
  for (const re of SECRET_PATTERNS) {
    re.lastIndex = 0;
    redacted = redacted.replace(re, () => {
      hits++;
      return '[REDACTED]';
    });
  }
  PROSE_SECRET.lastIndex = 0;
  redacted = redacted.replace(PROSE_SECRET, (full, prefix, value) => {
    const cleaned = value.replace(/[.,;:)]+$/, '');
    const suffix = value.slice(cleaned.length);
    if (!looksLikeCredential(cleaned)) return full;
    hits++;
    return `${prefix}[REDACTED]${suffix}`;
  });
  return { redacted, hits };
}

/**
 * Redact secrets in every string of a JSON-like value.
 * @param {unknown} value
 * @returns {unknown}
 */
function redactDeep(value) {
  if (typeof value === 'string') return redactSecrets(value).redacted;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = redactDeep(item);
    return out;
  }
  return value;
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
    const evidence = Array.isArray(n.evidence)
      ? n.evidence.map((item) => redactSecrets(String(item)).redacted)
      : [];
    stmt.run([
      n.id,
      n.kind,
      null,
      redactSecrets(String(n.label || '')).redacted,
      JSON.stringify({
        body: redactSecrets(String(n.body || '')).redacted,
        score: n.score,
        evidence,
      }),
    ]);
    stmt.free();
  }
}

module.exports = {
  redactSecrets,
  redactDeep,
  distillSessionChunk,
  upsertTypedNodes,
};
