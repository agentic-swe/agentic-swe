'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { usdForUsage } = require('./pricing.cjs');
const { withWriteLockSync } = require('./state-lock.cjs');

/**
 * @param {object} line parsed JSON line from Claude Code transcript
 * @returns {{ usage: object, model: string|null } | null}
 */
function extractUsageFromTranscriptLine(line) {
  if (!line || typeof line !== 'object') return null;
  const model = line.model || line.message?.model || null;
  let usage = line.usage || line.message?.usage || null;
  if (!usage && line.message && typeof line.message === 'object') {
    usage = line.message.usage || null;
  }
  if (!usage || typeof usage !== 'object') return null;
  return { usage, model };
}

const USAGE_TOTAL_KEYS = [
  'input_tokens',
  'output_tokens',
  'cache_read_input_tokens',
  'cache_creation_input_tokens',
];

function emptyUsageTotals() {
  const o = {};
  for (const k of USAGE_TOTAL_KEYS) o[k] = 0;
  return o;
}

/**
 * Add Anthropic-style usage fields into a running totals object (mutates target).
 * @param {Record<string, number>} target
 * @param {object} usage
 */
function addUsageIntoTotals(target, usage) {
  if (!usage || typeof usage !== 'object') return;
  for (const k of USAGE_TOTAL_KEYS) {
    const n = Number(usage[k]);
    if (Number.isFinite(n)) target[k] = (target[k] || 0) + n;
  }
}

/**
 * Read transcript JSONL from lineCursor (0 = start). Returns aggregated new USD, token deltas, and new cursor.
 * @param {string} transcriptPath absolute path
 * @param {number} lineCursor lines already billed
 */
function scanTranscriptIncremental(transcriptPath, lineCursor) {
  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  if (lineCursor > lines.length) lineCursor = 0;
  let newUsd = 0;
  let counted = 0;
  const usageDelta = emptyUsageTotals();
  for (let i = lineCursor; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    let obj;
    try {
      obj = JSON.parse(t);
    } catch {
      continue;
    }
    const ex = extractUsageFromTranscriptLine(obj);
    if (!ex) continue;
    newUsd += usdForUsage(ex.usage, ex.model);
    addUsageIntoTotals(usageDelta, ex.usage);
    counted += 1;
  }
  return { newUsd, endLine: lines.length, usageRows: counted, usageDelta };
}

/**
 * Apply transcript-derived cost to state.json (atomic write of full state).
 * @param {object} opts
 * @param {string} opts.workDir absolute .worklogs/<id>
 * @param {string} opts.transcriptPath absolute transcript path from hook
 * @param {boolean} [opts.dryRun]
 * @returns {object} result summary
 */
function syncCostFromTranscript(opts) {
  const { workDir, transcriptPath, dryRun } = opts;
  const statePath = path.join(workDir, 'state.json');

  if (!fs.existsSync(transcriptPath)) {
    return { ok: false, code: 'TRANSCRIPT_MISSING', message: `transcript not found: ${transcriptPath}` };
  }

  function applyScanToState(state) {
    if (!state.budget) state.budget = {};
    const ledger = state.budget.cost_ledger || {};
    let lineCursor = 0;
    if (ledger.transcript_path === transcriptPath && typeof ledger.line_cursor === 'number') {
      lineCursor = ledger.line_cursor;
    }
    const { newUsd, endLine, usageRows, usageDelta } = scanTranscriptIncremental(transcriptPath, lineCursor);
    const prev = typeof state.budget.cost_used === 'number' ? state.budget.cost_used : 0;
    const next = prev + newUsd;
    state.budget.cost_used = Number(next.toFixed(6));
    const baseTotals =
      state.budget.usage_totals && typeof state.budget.usage_totals === 'object'
        ? { ...state.budget.usage_totals }
        : emptyUsageTotals();
    for (const k of USAGE_TOTAL_KEYS) {
      const add = usageDelta[k] || 0;
      baseTotals[k] = Number((Number(baseTotals[k] || 0) + add).toFixed(0));
    }
    state.budget.usage_totals = baseTotals;
    state.budget.cost_ledger = {
      transcript_path: transcriptPath,
      line_cursor: endLine,
      last_sync_at: new Date().toISOString(),
      last_delta_usd: Number(newUsd.toFixed(6)),
      usage_rows_last_sync: usageRows,
    };
    state.updated_at = state.budget.cost_ledger.last_sync_at;
    return { prev, newUsd, endLine, usageRows, usageDelta };
  }

  if (dryRun) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const { prev, newUsd, endLine, usageDelta } = applyScanToState(state);
    return {
      ok: true,
      dryRun: true,
      previous_cost_used: prev,
      proposed_cost_used: state.budget.cost_used,
      delta_usd: newUsd,
      line_cursor_after: endLine,
      usage_delta: usageDelta,
      proposed_usage_totals: state.budget.usage_totals,
    };
  }

  try {
    return withWriteLockSync(workDir, () => {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const { prev, newUsd, endLine, usageRows, usageDelta } = applyScanToState(state);
      const tmp = `${statePath}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
      fs.renameSync(tmp, statePath);
      return {
        ok: true,
        previous_cost_used: prev,
        cost_used: state.budget.cost_used,
        delta_usd: newUsd,
        line_cursor_after: endLine,
        usage_rows: usageRows,
        usage_totals: state.budget.usage_totals,
        usage_delta: usageDelta,
      };
    });
  } catch (e) {
    if (e && e.code === 'LOCK_TIMEOUT') {
      return { ok: false, code: 'LOCK_TIMEOUT', message: String(e.message) };
    }
    throw e;
  }
}

module.exports = {
  extractUsageFromTranscriptLine,
  scanTranscriptIncremental,
  syncCostFromTranscript,
  emptyUsageTotals,
  addUsageIntoTotals,
};
