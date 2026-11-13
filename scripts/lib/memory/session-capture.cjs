'use strict';

const crypto = require('node:crypto');
const { scoreCapture, acceptsPattern } = require('./evidence-score.cjs');
const { redactSecrets, redactDeep } = require('../shared/redact.cjs');
const { upsertNodeRow } = require('./graph-store.cjs');
const { requireProvenance } = require('./provenance.cjs');

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
 * Each node must carry real provenance (ADR-012 / AE-030h5) — no silent defaults.
 * @param {*} db sql.js / node:sqlite wrapped database
 * @param {Array<{
 *   id: string,
 *   kind: string,
 *   label: string,
 *   body: string,
 *   score?: number,
 *   evidence?: string[],
 *   provenance: object,
 * }>} nodes
 */
function upsertTypedNodes(db, nodes) {
  for (const n of nodes) {
    const provenance = requireProvenance(n);
    const evidence = Array.isArray(n.evidence)
      ? n.evidence.map((item) => redactSecrets(String(item)).redacted)
      : [];
    const label = redactSecrets(String(n.label || '')).redacted;
    const body = redactSecrets(String(n.body || '')).redacted;
    const meta = {
      body,
      score: n.score,
      evidence,
    };
    upsertNodeRow(db, {
      id: n.id,
      kind: n.kind,
      path: null,
      label,
      metaJson: JSON.stringify(meta),
      recordJson: JSON.stringify({
        id: n.id,
        kind: n.kind,
        provenance,
        trust: 'untrusted',
        redaction: { applied: true, ruleset: 'redact.cjs', hits: 0 },
      }),
    });
  }
}

module.exports = {
  redactSecrets,
  redactDeep,
  distillSessionChunk,
  upsertTypedNodes,
};
