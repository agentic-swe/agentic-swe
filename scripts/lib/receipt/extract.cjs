const fs = require('node:fs');
const path = require('node:path');
const { integrityReport } = require('../work-engine/journal.cjs');

function extractReceipt(workDir) {
  const statePath = path.join(workDir, 'state.json');
  if (!fs.existsSync(statePath)) {
    throw new Error(`state.json not found at ${statePath}`);
  }
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const history = Array.isArray(state.history) ? state.history : [];

  const decisions = history
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

  const humanGates = history
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
  return {
    integrity: integrity.integrity,
    historyGap: integrity.historyGap,
    workId: state.work_id || path.basename(workDir),
    task: state.task || '',
    track: state.pipeline && state.pipeline.track ? state.pipeline.track : 'unknown',
    status: state.current_state || 'unknown',
    costUsd: state.budget && typeof state.budget.cost_used === 'number' ? state.budget.cost_used : 0,
    budgetRemaining: state.budget && typeof state.budget.budget_remaining === 'number' ? state.budget.budget_remaining : null,
    durationSeconds,
    decisions,
    humanGates,
    counters: state.counters || {},
    prUrl,
    auditEntryCount,
    toolCallCount,
    toolCallDenied,
    workDir,
  };
}

module.exports = { extractReceipt };
