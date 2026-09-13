'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { discoverActiveWorkDirWithMeta } = require('../work-engine/discover-workdir.cjs');

/**
 * Resolve the default memory-prime search query.
 * Priority: explicit arg → AGENTIC_SWE_MEMORY_PRIME_QUERY → active work item `task`.
 * @param {{ projectRoot: string, query?: string|null, workId?: string|null }} opts
 * @returns {{ query: string|null, source: string|null, workId: string|null, warning: string|null }}
 */
function resolvePrimeQuery(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  if (opts.query != null && String(opts.query).trim()) {
    return { query: String(opts.query).trim(), source: 'explicit', workId: opts.workId || null, warning: null };
  }
  const envQ = process.env.AGENTIC_SWE_MEMORY_PRIME_QUERY;
  if (envQ != null && String(envQ).trim()) {
    return { query: String(envQ).trim(), source: 'env', workId: opts.workId || null, warning: null };
  }

  let workDir = null;
  let warning = null;
  if (opts.workId) {
    workDir = path.join(projectRoot, '.worklogs', opts.workId);
    if (!fs.existsSync(path.join(workDir, 'state.json'))) {
      workDir = null;
    }
  }
  if (!workDir) {
    const meta = discoverActiveWorkDirWithMeta(projectRoot);
    workDir = meta.workDir;
    warning = meta.warning;
  }
  if (!workDir) {
    return { query: null, source: null, workId: opts.workId || null, warning };
  }

  const statePath = path.join(workDir, 'state.json');
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const task = state && state.task != null ? String(state.task).trim() : '';
    if (task && task !== '<user task>') {
      return {
        query: task,
        source: 'work-item',
        workId: opts.workId || path.basename(workDir),
        warning,
      };
    }
  } catch {
    /* ignore */
  }
  return { query: null, source: null, workId: opts.workId || null, warning };
}

module.exports = { resolvePrimeQuery };
