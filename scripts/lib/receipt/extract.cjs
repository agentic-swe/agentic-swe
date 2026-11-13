const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { integrityReport, readJournal } = require('../shared/journal.cjs');
const { localAnchorReport } = require('../github/anchor.cjs');
const { redactDeep } = require('../shared/redact.cjs');

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function journalData(workDir, state) {
  const chain = readJournal(workDir);
  if (chain.missing) return null;
  if (!chain.ok) return { invalid: true };
  const events = chain.events;
  const snapshots = events.filter((e) => e.state && typeof e.state === 'object');
  const decisions = snapshots
    .filter((e) => e.state.current_state && e.state.current_state !== 'initialized')
    .map((e) => {
      const history = Array.isArray(e.state.history) ? e.state.history : [];
      const h = history[history.length - 1] || {};
      return {
        at: h.at || e.at,
        phase: h.from || '',
        destination: h.to || e.state.current_state,
        actor: h.actor || '',
        reason: h.reason || '',
        costUsd: typeof h.cost_delta_usd === 'number' ? h.cost_delta_usd : 0,
        evidenceRefs: Array.isArray(h.evidence_refs) ? h.evidence_refs : [],
        source_seq: e.seq,
      };
    })
    .filter((d) => d.phase && d.destination);
  const side = (type) => events.filter((e) => e.type === type).map((e) => ({
    ...redactDeep(e.payload || {}),
    source_seq: e.seq,
    at: e.at,
  }));
  const gates = decisions
    .filter((d) => d.phase === 'approval-wait' || d.phase === 'ambiguity-wait')
    .map((d) => ({ state: d.phase, resolvedBy: d.actor, at: d.at, reason: d.reason, source_seq: d.source_seq }));
  const reviews = snapshots
    .filter((e) => e.type === 'review.recorded' || e.type === 'review.failed')
    .map((e) => {
      const reviews = Array.isArray(e.state.reviews) ? e.state.reviews : [];
      const review = reviews[reviews.length - 1] || e.state.review || e.state.last_review || {};
      return { ...review, source_seq: e.seq };
    });
  const approvals = snapshots
    .filter((e) => e.type === 'approve' || e.type === 'github.verified')
    .map((e) => {
      const approval = e.state.approvals && e.state.approvals.github_verification
        ? e.state.approvals.github_verification
        : (e.state.approval || e.state.github_verification || {});
      return { type: e.type, ...approval, source_seq: e.seq };
    });

  const artifacts = [];
  // receipt.json / receipt.md are receipt outputs; digesting them would make a
  // re-render record a stale self-digest and fail its own ARTIFACT_MISMATCH check.
  const ignored = new Set([
    'state.json',
    'journal.jsonl',
    'idempotency-index.json',
    'audit.log',
    'receipt.json',
    'receipt.md',
  ]);
  for (const name of fs.readdirSync(workDir)) {
    const file = path.join(workDir, name);
    if (ignored.has(name) || !fs.statSync(file).isFile()) continue;
    artifacts.push({
      path: name,
      sha256: digestFile(file),
      producer: 'worklog',
      source_seq: events.length ? events[events.length - 1].seq : null,
    });
  }
  return {
    decisions,
    humanGates: gates,
    toolCalls: side('tool.requested'),
    toolResults: side('tool.completed'),
    policyDecisions: side('policy.decided'),
    usage: side('usage.recorded'),
    tests: side('test.side'),
    // AE-035a: governed self-improvement events (ADR-011 fold).
    improvementsProposed: side('improvement.proposed'),
    improvementsEvaluated: side('improvement.evaluated'),
    reviews,
    approvals,
    artifacts,
  };
}

function extractReceipt(workDir) {
  const statePath = path.join(workDir, 'state.json');
  if (!fs.existsSync(statePath)) {
    throw new Error(`state.json not found at ${statePath}`);
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const chainData = journalData(workDir, state);
  const history = Array.isArray(state.history) ? state.history : [];

  const legacyDecisions = history
    .filter((h) => h.from !== 'initialized')
    .map((h) => ({
      at: h.at,
      phase: h.from,
      destination: h.to,
      actor: h.actor,
      reason: h.reason || '',
      costUsd: typeof h.cost_delta_usd === 'number' ? h.cost_delta_usd : 0,
      evidenceRefs: Array.isArray(h.evidence_refs) ? h.evidence_refs : [],
    }));

  const legacyGates = history
    .filter((h) => h.from === 'approval-wait' || h.from === 'ambiguity-wait')
    .map((h) => ({
      state: h.from,
      resolvedBy: h.actor,
      at: h.at,
      reason: h.reason || '',
    }));

  const created = state.created_at ? Date.parse(state.created_at) : null;
  const updated = state.updated_at ? Date.parse(state.updated_at) : null;
  const durationSeconds = created && updated ? Math.round((updated - created) / 1000) : null;

  const prLinkPath = path.join(workDir, 'pr-link.txt');
  const prUrl = fs.existsSync(prLinkPath)
    ? fs.readFileSync(prLinkPath, 'utf8').trim()
    : null;

  const auditPath = path.join(workDir, 'audit.log');
  const auditLines = fs.existsSync(auditPath)
    ? fs.readFileSync(auditPath, 'utf8').split('\n').filter((l) => l.trim().length > 0)
    : [];
  const auditEntryCount = auditLines.length;
  const auditToolCalls = auditLines.filter((l) => / action=tool_call /.test(l));
  const auditToolCallCount = auditToolCalls.length;
  const auditToolCallDenied = auditToolCalls.filter((l) => / decision=deny /.test(l)).length;

  const integrity = integrityReport(workDir, state);
  const anchor = localAnchorReport(workDir, state);
  const journalOk = chainData && !chainData.invalid;
  const legacy = !chainData;

  const usage = journalOk ? chainData.usage : [];
  const usageCost = usage.reduce((sum, row) => {
    const usd = row && typeof row.usd === 'number' ? row.usd : 0;
    return sum + usd;
  }, 0);
  const stateCost = state.budget && typeof state.budget.cost_used === 'number' ? state.budget.cost_used : 0;
  // ADR-011: cost is a fold over usage.recorded when a journal exists.
  const costUsd = journalOk ? usageCost : (legacy ? stateCost : 0);

  const trust = String(anchor.anchor || '').includes('(independent)') ? 'enforced' : 'cooperative';

  const divergences = [];
  if (journalOk && Math.abs(usageCost - stateCost) > 1e-9) {
    divergences.push({
      field: 'costUsd',
      journal: usageCost,
      projection: stateCost,
      note: 'state.budget.cost_used differs from usage.recorded fold',
    });
  }
  if (journalOk && state.counters && Object.keys(state.counters).length) {
    divergences.push({
      field: 'counters',
      journal: null,
      projection: state.counters,
      note: 'counters remain a state.json projection; not receipt content',
    });
  }
  if (auditToolCallCount > 0) {
    divergences.push({
      field: 'audit.tool_calls',
      journal: journalOk ? (chainData.toolCalls || []).length : null,
      projection: { count: auditToolCallCount, denied: auditToolCallDenied },
      note: 'audit.log tool_call regex counts are not receipt content',
    });
  }

  const data = {
    integrity: integrity.integrity,
    trust,
    trustDisclaimer: trust === 'cooperative'
      ? 'cooperative evidence: the producing agent could rewrite this log.'
      : null,
    legacy: legacy ? 'LEGACY: not log-derived' : null,
    anchor: anchor.anchor,
    historyGap: integrity.historyGap,
    workId: state.work_id || path.basename(workDir),
    task: state.task || '',
    track: state.pipeline && state.pipeline.track ? state.pipeline.track : 'unknown',
    status: state.current_state || 'unknown',
    costUsd,
    budgetRemaining: state.budget && typeof state.budget.budget_remaining === 'number' ? state.budget.budget_remaining : null,
    durationSeconds,
    decisions: journalOk ? chainData.decisions : (legacy ? legacyDecisions : []),
    humanGates: journalOk ? chainData.humanGates : (legacy ? legacyGates : []),
    // Counters are not journal-derived receipt content (ADR-011).
    counters: legacy ? (state.counters || {}) : {},
    prUrl,
    // Kept for CI contract / divergence consumers; not rendered as content when journal-backed.
    auditEntryCount,
    toolCallCount: auditToolCallCount,
    toolCallDenied: auditToolCallDenied,
    toolCalls: journalOk ? chainData.toolCalls : [],
    toolResults: journalOk ? chainData.toolResults : [],
    policyDecisions: journalOk ? chainData.policyDecisions : [],
    tests: journalOk ? chainData.tests : [],
    improvementsProposed: journalOk ? chainData.improvementsProposed : [],
    improvementsEvaluated: journalOk ? chainData.improvementsEvaluated : [],
    reviews: journalOk ? chainData.reviews : [],
    approvals: journalOk ? chainData.approvals : [],
    usage,
    artifacts: journalOk ? chainData.artifacts : [],
    journalHead: journalOk ? readJournal(workDir).head : null,
    divergences,
    workDir,
  };
  return redactDeep(data);
}

module.exports = { extractReceipt };
