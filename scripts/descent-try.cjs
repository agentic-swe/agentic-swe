#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { loadWorkItem } = require('./lib/work-engine/engine.cjs');
const { projectRootFromWorkDir } = require('./lib/work-engine/budget-config.cjs');
const { extractDeclaredFiles } = require('./lib/scope/diff-scope-check.cjs');
const { tryLadderThenOverlap, procedureVerifyCommand } = require('./lib/descent/overlap-procedure.cjs');

function parseArgs(argv) {
  const out = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--verify') out.verify = argv[++i];
    else if (a === '--work-dir') out.workDir = path.resolve(argv[++i]);
    else if (a === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (a === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (a === '--files') out.files = argv[++i];
  }
  return out;
}

function declaredFilesForWorkDir(workDir) {
  const designPath = path.join(workDir, 'design.md');
  const implPath = path.join(workDir, 'implementation.md');
  const declared = extractDeclaredFiles(designPath) || extractDeclaredFiles(implPath);
  if (declared && declared.size) return [...declared].sort().slice(0, 24);
  return [path.basename(workDir)];
}

async function main() {
  const args = parseArgs(process.argv);
  const pluginRoot = args.pluginRoot || getDefaultPluginRoot();
  const projectRoot =
    args.projectRoot ||
    (args.workDir ? projectRootFromWorkDir(args.workDir) : null) ||
    process.env.AGENTIC_SWE_PROJECT_ROOT ||
    process.cwd();
  const storeRoot = path.resolve(process.env.AGENTIC_SWE_PROCEDURE_STORE || projectRoot);

  let verify = args.verify;
  let files;
  if (args.files) {
    files = String(args.files)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (args.workDir) {
    const loaded = loadWorkItem(args.workDir, pluginRoot);
    if (loaded.ok) {
      if (!verify && loaded.state.metrics?.verify_command) verify = loaded.state.metrics.verify_command;
    }
    files = declaredFilesForWorkDir(args.workDir);
  }

  const { descent: r, overlap, hit } = await tryLadderThenOverlap({
    projectRoot,
    pluginRoot,
    storeRoot,
    verifyCommand: verify || 'npm test',
    files,
    cwd: projectRoot,
    skipL2: false,
    strictFingerprint: false,
  });

  if (args.workDir) {
    try {
      const { recordDescentTierUsage } = require('./lib/descent/record-descent-tier.cjs');
      const usedVerify = (hit && overlap && procedureVerifyCommand(overlap)) || verify || 'npm test';
      recordDescentTierUsage({
        workDir: args.workDir,
        pluginRoot,
        tier: r.tier || 'L3',
        hit: r.ok === true,
        source: hit && overlap ? 'git-or-transcript-overlap' : 'descent-try',
        metricsPatch:
          hit && overlap
            ? { verify_command: usedVerify, descent_verify_command: usedVerify }
            : undefined,
      });
    } catch {
      /* optional tier attribution */
    }
  }

  const out = {
    ok: r.ok,
    tier: r.tier,
    delivered_tokens: r.delivered_tokens,
    frontier_tokens: r.frontier_tokens,
    reason: r.reason,
    fingerprint: r.fingerprint,
    overlap_source: hit && overlap ? overlap.procedure?._meta?.source || null : null,
  };
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else if (r.ok) console.log(`${r.tier} HIT`, r.delivered_tokens, 'tokens', r.fingerprint?.slice(0, 12) || '');
  else console.log('ESCALATE', r.tier, r.reason);
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
