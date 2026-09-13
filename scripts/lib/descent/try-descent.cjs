'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadStore } = require('./promotion.cjs');
const { buildFingerprint } = require('./fingerprint.cjs');
const { replayProcedureWithTelemetry } = require('./replay.cjs');
const { recordTierEvent } = require('./tier-telemetry.cjs');
const { findProcedureByVerify } = require('./corpus-seed.cjs');
const { runTaskAcceptance } = require('../bench/run-task.cjs');

/**
 * Attempt L0 replay before LLM execution.
 * @param {{ projectRoot: string, verifyCommand?: string, files?: string[], fingerprint?: string }} opts
 */
function tryDescent(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const data = loadStore(projectRoot);

  let rec = null;
  if (opts.fingerprint) {
    rec = data.procedures.find((p) => p.fingerprint === opts.fingerprint && p.tier === 'L0');
  }
  if (!rec && opts.files?.length && opts.verifyCommand) {
    const fp = buildFingerprint({
      files: opts.files,
      verifyCommand: opts.verifyCommand,
      failureSignature: '',
    });
    rec = data.procedures.find((p) => p.fingerprint === fp && p.tier === 'L0');
  }
  if (!rec && opts.verifyCommand) {
    rec = findProcedureByVerify(projectRoot, opts.verifyCommand);
  }

  if (!rec) {
    recordTierEvent(projectRoot, 'L3', false);
    return {
      ok: false,
      tier: 'L3',
      escalate: true,
      reason: 'no L0 procedure match',
      frontier_tokens: null,
    };
  }

  const r = replayProcedureWithTelemetry({ projectRoot, procedure: rec.procedure });
  return {
    ...r,
    fingerprint: rec.fingerprint,
    frontier_tokens: r.ok ? 0 : null,
    procedure_tier: rec.tier,
  };
}

/**
 * Run descent-first against corpus tasks; measure L0 hit rate.
 * @param {{ pluginRoot: string, projectRoot?: string }} opts
 */
function runCorpusDescentBench(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot);
  const projectRoot = path.resolve(opts.projectRoot || pluginRoot);
  const corpusRoot = path.join(pluginRoot, 'bench', 'corpus');
  const tasks = [];

  for (const name of fs.readdirSync(corpusRoot)) {
    const taskDir = path.join(corpusRoot, name);
    if (!fs.statSync(taskDir).isDirectory()) continue;
    if (!fs.existsSync(path.join(taskDir, 'scoring.json'))) continue;

    const acceptance = runTaskAcceptance(taskDir);
    const scoring = JSON.parse(fs.readFileSync(path.join(taskDir, 'scoring.json'), 'utf8'));
    const verify = scoring.task_pass?.command || '';

    const descent = tryDescent({ projectRoot, verifyCommand: verify, files: [name] });
    const l0Hit = descent.ok === true;
    const frontierTokens = l0Hit ? 0 : 200000;

    tasks.push({
      id: name,
      l0_hit: l0Hit,
      acceptance_ok: acceptance.ok,
      delivered: acceptance.ok,
      frontier_tokens: frontierTokens,
      descent,
    });
  }

  const delivered = tasks.filter((t) => t.delivered).length;
  const l0Hits = tasks.filter((t) => t.l0_hit && t.delivered).length;
  const totalFrontier = tasks.reduce((s, t) => s + (t.delivered ? t.frontier_tokens : t.frontier_tokens), 0);
  const coldFrontier = tasks.length * 200000;
  const deliveredFrontier = tasks.filter((t) => t.delivered).reduce((s, t) => s + t.frontier_tokens, 0);

  return {
    ok: true,
    tasks,
    summary: {
      total: tasks.length,
      delivered,
      l0_hits: l0Hits,
      l0_hit_rate: tasks.length ? l0Hits / tasks.length : 0,
      l0_hit_rate_delivered: delivered ? l0Hits / delivered : 0,
      frontier_tokens_total: deliveredFrontier,
      frontier_tokens_cold_estimate: coldFrontier,
      portfolio_multiplier: coldFrontier ? deliveredFrontier / coldFrontier : 1,
      median_frontier_per_delivered: delivered ? deliveredFrontier / delivered : 0,
    },
  };
}

module.exports = { tryDescent, runCorpusDescentBench };
