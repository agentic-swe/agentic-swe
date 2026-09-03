'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadStore, promoteOrDemote } = require('./promotion.cjs');
const { buildFingerprint } = require('./fingerprint.cjs');
const { replayProcedureWithTelemetry, executeAction } = require('./replay.cjs');
const { recordTierEvent } = require('./tier-telemetry.cjs');
const { findProcedureByVerify } = require('./corpus-seed.cjs');
const { openOrCreateDatabase, closeDatabase } = require('../memory/graph-store.cjs');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('../memory/config.cjs');
const { extractSearchTokens, queryChunkHits } = require('../memory/memory-prime.cjs');
const { buildRepoMap } = require('../repo-map/build.cjs');

const DEFAULT_TIER_TOKENS = { L0: 0, L1: 1500, L2: 8000, L3: 200000 };

function loadTierTokenEstimates(pluginRoot) {
  const p = path.join(pluginRoot, 'config', 'descent.default.json');
  if (!fs.existsSync(p)) return { ...DEFAULT_TIER_TOKENS };
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return { ...DEFAULT_TIER_TOKENS, ...(j.tier_token_estimates || {}) };
  } catch {
    return { ...DEFAULT_TIER_TOKENS };
  }
}

/**
 * @param {object[]} procedures
 * @param {{ fingerprint?: string, files?: string[], verifyCommand?: string }} opts
 * @param {string} tier
 */
function isReplayEligible(rec) {
  return rec && rec.eval_status !== 'unevaluated';
}

function findProcedureRecord(procedures, opts, tier) {
  if (opts.fingerprint) {
    const rec = procedures.find(
      (p) => p.fingerprint === opts.fingerprint && p.tier === tier && isReplayEligible(p)
    );
    if (rec) return rec;
  }
  if (opts.files?.length && opts.verifyCommand) {
    const fp = buildFingerprint({
      files: opts.files,
      verifyCommand: opts.verifyCommand,
      failureSignature: '',
    });
    const rec = procedures.find((p) => p.fingerprint === fp && p.tier === tier && isReplayEligible(p));
    if (rec) return rec;
  }
  if (opts.strictFingerprint) return null;
  if (!opts.verifyCommand) return null;
  const norm = String(opts.verifyCommand).trim();
  if (tier === 'L0') {
    const rec = findProcedureByVerify(opts.projectRoot, norm);
    return isReplayEligible(rec) ? rec : null;
  }
  for (const rec of procedures) {
    if (rec.tier !== tier) continue;
    if (!isReplayEligible(rec)) continue;
    const verify = rec.procedure?.verify?.[0]?.command || rec.procedure?.actions?.[0]?.command;
    if (verify && verify.trim() === norm) return rec;
  }
  return null;
}

async function tryL2MemoryVerify(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot || projectRoot);
  const verify = String(opts.verifyCommand || '').trim();
  if (!verify) return { ok: false };

  const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
  const sqlitePath = sqlitePathForProject(merged, projectRoot);
  if (!fs.existsSync(sqlitePath)) return { ok: false };

  const tokens = extractSearchTokens(`${verify} ${(opts.files || []).join(' ')}`);
  if (!tokens.length) return { ok: false };

  let db;
  try {
    const opened = await openOrCreateDatabase(sqlitePath);
    db = opened.db;
    const hits = queryChunkHits(db, tokens, 3, null);
    if (hits.length < 2) return { ok: false };

    const r = executeAction({ type: 'RUN', command: verify, cwd: opts.cwd || projectRoot }, projectRoot);
    recordTierEvent(projectRoot, 'L2', r.ok);
    if (!r.ok) return { ok: false, tier: 'L2', reason: 'memory-guided verify failed' };

    return {
      ok: true,
      tier: 'L2',
      escalate: false,
      reason: 'memory-guided verify',
      memory_hits: hits.length,
      steps: [{ phase: 'verify', action: { type: 'RUN', command: verify }, ...r }],
    };
  } catch {
    return { ok: false };
  } finally {
    if (db) closeDatabase(db);
  }
}

function tryL2RepoMapVerify(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const verify = String(opts.verifyCommand || '').trim();
  const file = opts.files?.[0];
  if (!file || !verify) return { ok: false };

  try {
    const map = buildRepoMap(projectRoot);
    const norm = file.replace(/\\/g, '/');
    const tests = map.testsFor.get(norm) || [];
    if (!tests.length) return { ok: false };

    const testCmd = `node --test ${tests[0]}`;
    const r = executeAction({ type: 'RUN', command: testCmd, cwd: projectRoot }, projectRoot);
    recordTierEvent(projectRoot, 'L2', r.ok);
    if (!r.ok) return { ok: false, tier: 'L2', reason: 'repo-map verify failed' };

    return {
      ok: true,
      tier: 'L2',
      escalate: false,
      reason: 'repo-map test verify',
      test_file: tests[0],
      steps: [{ phase: 'verify', action: { type: 'RUN', command: testCmd }, ...r }],
    };
  } catch {
    return { ok: false };
  }
}

/**
 * Full descent ladder L0 → L1 → L2 → L3 with tier token attribution.
 * @param {{ projectRoot: string, pluginRoot?: string, verifyCommand?: string, files?: string[], fingerprint?: string, cwd?: string }} opts
 */
async function tryDescentLadder(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot || projectRoot);
  const storeRoot = path.resolve(opts.storeRoot || projectRoot);
  const tokenEst = loadTierTokenEstimates(pluginRoot);
  const data = loadStore(storeRoot);
  const ladderOpts = { ...opts, projectRoot, storeRoot };

  for (const tier of ['L0', 'L1']) {
    const rec = findProcedureRecord(data.procedures, ladderOpts, tier);
    if (!rec) continue;
    const r = replayProcedureWithTelemetry({ projectRoot, procedure: rec.procedure });
    if (r.ok) {
      if (tier === 'L1') {
        promoteOrDemote({
          projectRoot: storeRoot,
          fingerprint: rec.fingerprint,
          procedure: rec.procedure,
          evalPassed: true,
          successCapture: true,
        });
      }
      return {
        ...r,
        tier,
        fingerprint: rec.fingerprint,
        frontier_tokens: tokenEst[tier],
        delivered_tokens: tokenEst[tier],
        procedure_tier: tier,
      };
    }
  }

  if (!opts.skipL2) {
    const mem = await tryL2MemoryVerify({ ...ladderOpts, pluginRoot });
    if (mem.ok) {
      return {
        ...mem,
        fingerprint: null,
        frontier_tokens: tokenEst.L2,
        delivered_tokens: tokenEst.L2,
        procedure_tier: 'L2',
      };
    }

    const repo = tryL2RepoMapVerify(ladderOpts);
    if (repo.ok) {
      return {
        ...repo,
        fingerprint: null,
        frontier_tokens: tokenEst.L2,
        delivered_tokens: tokenEst.L2,
        procedure_tier: 'L2',
      };
    }
  }

  recordTierEvent(projectRoot, 'L3', false);
  return {
    ok: false,
    tier: 'L3',
    escalate: true,
    reason: 'ladder exhausted — frontier required',
    frontier_tokens: tokenEst.L3,
    delivered_tokens: tokenEst.L3,
    procedure_tier: 'L3',
  };
}

async function tryDescentLadderWithFallback(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pluginRoot = path.resolve(opts.pluginRoot || projectRoot);
  let r = await tryDescentLadder({ ...opts, projectRoot, pluginRoot });
  if (!r.ok && path.resolve(pluginRoot) !== projectRoot) {
    const packOnConsumer = await tryDescentLadder({
      ...opts,
      projectRoot,
      pluginRoot,
      storeRoot: pluginRoot,
    });
    if (packOnConsumer.ok) return packOnConsumer;
    const packAsProject = await tryDescentLadder({
      ...opts,
      projectRoot: pluginRoot,
      pluginRoot,
      storeRoot: pluginRoot,
    });
    if (packAsProject.ok) r = packAsProject;
  }
  return r;
}

module.exports = {
  loadTierTokenEstimates,
  findProcedureRecord,
  tryDescentLadder,
  tryDescentLadderWithFallback,
  tryL2MemoryVerify,
  tryL2RepoMapVerify,
  DEFAULT_TIER_TOKENS,
};
