'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STORE = '.agentic-swe/procedures.json';

/**
 * @typedef {{ fingerprint: string, tier: string, procedure: object, failures: number, promoted_at?: string, human_approved?: boolean }} ProcedureRecord
 */

function loadStore(projectRoot) {
  const p = path.join(projectRoot, DEFAULT_STORE);
  if (!fs.existsSync(p)) return { procedures: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveStore(projectRoot, data) {
  const p = path.join(projectRoot, DEFAULT_STORE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

/**
 * Promotion pipeline: L3 → L1 candidate → L0 after eval + human approval.
 * Auto-demote after two verification failures.
 * @param {{ projectRoot: string, fingerprint: string, procedure: object, evalPassed: boolean, humanApproved?: boolean, verifyFailed?: boolean }} opts
 */
function promoteOrDemote(opts) {
  const data = loadStore(opts.projectRoot);
  let rec = data.procedures.find((p) => p.fingerprint === opts.fingerprint);
  if (!rec) {
    rec = {
      fingerprint: opts.fingerprint,
      tier: 'L1',
      procedure: opts.procedure,
      failures: 0,
      eval_status: 'unevaluated',
    };
    data.procedures.push(rec);
  }

  if (opts.verifyFailed) {
    rec.failures = (rec.failures || 0) + 1;
    if (rec.failures >= 2) {
      rec.tier = 'L1';
      rec.human_approved = false;
    }
    saveStore(opts.projectRoot, data);
    return { record: rec, demoted: rec.failures >= 2 };
  }

  if (opts.successCapture) {
    rec.procedure = opts.procedure || rec.procedure;
    rec.success_count = (rec.success_count || 0) + 1;
    rec.last_capture_at = new Date().toISOString();
    if (opts.evalPassed) rec.eval_status = 'evaluated';
    else if (opts.evalPassed === false) rec.eval_status = rec.eval_status || 'unevaluated';
    if (rec.success_count >= 2) {
      rec.tier = 'L0';
      rec.human_approved = true;
      rec.promoted_at = new Date().toISOString();
      rec.failures = 0;
    } else {
      rec.tier = 'L1';
    }
    saveStore(opts.projectRoot, data);
    return { record: rec, demoted: false, autoPromoted: rec.tier === 'L0' };
  }

  if (opts.evalPassed) rec.eval_status = 'evaluated';
  else if (opts.evalPassed === false) rec.eval_status = rec.eval_status || 'unevaluated';

  if (opts.evalPassed && opts.humanApproved && rec.tier !== 'L0') {
    rec.tier = 'L0';
    rec.human_approved = true;
    rec.promoted_at = new Date().toISOString();
    rec.failures = 0;
  } else if (opts.evalPassed && !rec.human_approved) {
    rec.tier = 'L1';
  }

  saveStore(opts.projectRoot, data);
  return { record: rec, demoted: false };
}

/**
 * @param {string} projectRoot
 * @returns {{ L0: number, L1: number, L2: number, L3: number, total: number }}
 */
function tierHitRates(projectRoot) {
  const data = loadStore(projectRoot);
  const counts = { L0: 0, L1: 0, L2: 0, L3: 0, total: data.procedures.length };
  for (const p of data.procedures) {
    const t = p.tier || 'L1';
    if (counts[t] != null) counts[t]++;
  }
  return counts;
}

module.exports = {
  loadStore,
  saveStore,
  promoteOrDemote,
  tierHitRates,
  DEFAULT_STORE,
};
