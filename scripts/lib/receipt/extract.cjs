const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { integrityReport, readJournal } = require('../shared/journal.cjs');
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
  const ignored = new Set(['state.json', 'journal.jsonl', 'idempotency-index.json', 'audit.log']);
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
  const toolCalls = auditLines.filter((l) => / action=tool_call /.test(l));
  const toolCallCount = toolCalls.length;
  const toolCallDenied = toolCalls.filter((l) => / decision=deny /.test(l)).length;

  const integrity = integrityReport(workDir, state);
  const data = {
    integrity: integrity.integrity,
    historyGap: integrity.historyGap,
    workId: state.work_id || path.basename(workDir),
    task: state.task || '',
    track: state.pipeline && state.pipeline.track ? state.pipeline.track : 'unknown',
    status: state.current_state || 'unknown',
    costUsd: state.budget && typeof state.budget.cost_used === 'number' ? state.budget.cost_used : 0,
    budgetRemaining: state.budget && typeof state.budget.budget_remaining === 'number' ? state.budget.budget_remaining : null,
    durationSeconds,
    decisions: chainData && !chainData.invalid ? chainData.decisions : (chainData ? [] : legacyDecisions),
    humanGates: chainData && !chainData.invalid ? chainData.humanGates : (chainData ? [] : legacyGates),
    counters: state.counters || {},
    prUrl,
    auditEntryCount,
    toolCallCount,
    toolCallDenied,
    toolCalls: chainData && !chainData.invalid ? chainData.toolCalls : [],
    toolResults: chainData && !chainData.invalid ? chainData.toolResults : [],
    policyDecisions: chainData && !chainData.invalid ? chainData.policyDecisions : [],
    tests: chainData && !chainData.invalid ? chainData.tests : [],
    reviews: chainData && !chainData.invalid ? chainData.reviews : [],
    approvals: chainData && !chainData.invalid ? chainData.approvals : [],
    usage: chainData && !chainData.invalid ? chainData.usage : [],
    artifacts: chainData && !chainData.invalid ? chainData.artifacts : [],
    journalHead: chainData && !chainData.invalid ? readJournal(workDir).head : null,
    workDir,
  };
  return redactDeep(data);
}

module.exports = { extractReceipt };
