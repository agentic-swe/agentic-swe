#!/usr/bin/env node
/**
 * Claude Code Stop hook: read hook JSON from stdin, update active work item's budget.cost_used
 * from new transcript lines. Always exits 0 (non-blocking).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { discoverActiveWorkDirWithMeta } = require('./discover-workdir.cjs');
const { syncCostFromTranscript } = require('./transcript-cost.cjs');

function main() {
  let stdin = '';
  try {
    stdin = fs.readFileSync(0, 'utf8');
  } catch {
    process.exit(0);
  }
  try {
    const hook = JSON.parse(stdin || '{}');
    const transcriptPath = hook.transcript_path;
    const cwd = hook.cwd || process.cwd();
    if (!transcriptPath || typeof transcriptPath !== 'string') process.exit(0);

    const projectRoot = path.resolve(process.env.AGENTIC_SWE_PROJECT_ROOT || cwd);
    let workDir;
    if (process.env.AGENTIC_SWE_WORK_DIR) {
      workDir = path.resolve(process.env.AGENTIC_SWE_WORK_DIR);
    } else {
      const meta = discoverActiveWorkDirWithMeta(projectRoot);
      if (meta.warning) console.error('[agentic-swe]', meta.warning);
      workDir = meta.workDir;
    }
    if (!workDir) process.exit(0);

    const r = syncCostFromTranscript({ workDir, transcriptPath, dryRun: false });
    if (!r.ok && process.env.AGENTIC_SWE_COST_HOOK_DEBUG) {
      console.error('[agentic-swe hook-record-cost]', r.message || r);
    }
  } catch (e) {
    if (process.env.AGENTIC_SWE_COST_HOOK_DEBUG) {
      console.error('[agentic-swe hook-record-cost]', e && e.message);
    }
  }
  process.exit(0);
}

main();
