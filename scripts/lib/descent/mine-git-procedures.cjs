'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseGitLogNameOnly } = require('../memory/git-log-parse.cjs');
const { buildFingerprint } = require('./fingerprint.cjs');
const { promoteOrDemote } = require('./promotion.cjs');
const { evalProcedureVerify, isolatedVerifyRel } = require('./procedure-eval.cjs');

function isSkippablePath(rel) {
  return (
    !rel ||
    rel.startsWith('node_modules/') ||
    rel.startsWith('.git/') ||
    rel.includes('..')
  );
}

function isCodeOrTestPath(rel) {
  return /\.(js|cjs|mjs|ts|tsx)$/.test(rel);
}

function isIsolatedTestPath(rel) {
  return /^(test|tests)\//.test(rel) && /\.(js|cjs|mjs)$/.test(rel);
}

/**
 * Mine fingerprint-scoped procedures from git: tests that co-changed with code.
 * Evaluate only isolated `node --test <file>` / `node test/…` (never whole-repo npm test).
 *
 * @param {{ projectRoot: string, pluginRoot?: string, maxCommits?: number, limit?: number }} opts
 */
function mineGitProcedures(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const storeRoot = path.resolve(opts.storeRoot || projectRoot);
  const maxCommits = opts.maxCommits || 30;
  const limit = opts.limit || 12;
  if (!fs.existsSync(path.join(projectRoot, '.git'))) {
    return { ok: true, mined: 0, procedures: 0, reason: 'not a git repository' };
  }

  const r = spawnSync(
    'git',
    ['-C', projectRoot, 'log', `-n${maxCommits}`, '--no-merges', '--pretty=format:%H%x09%an%x09%s', '--name-only'],
    { encoding: 'utf8', timeout: 20000 }
  );
  if (r.status !== 0) {
    return { ok: true, mined: 0, procedures: 0, reason: (r.stderr || 'git log failed').slice(0, 200) };
  }

  const commits = parseGitLogNameOnly(r.stdout, maxCommits);
  let procedures = 0;
  let mined = 0;
  for (const c of commits) {
    if (procedures >= limit) break;
    const rels = (c.files || [])
      .map((f) => String(f).split(path.sep).join('/'))
      .filter((f) => !isSkippablePath(f) && isCodeOrTestPath(f))
      .filter((f) => fs.existsSync(path.join(projectRoot, f)));
    const tests = rels.filter(isIsolatedTestPath);
    if (!tests.length) continue;
    mined++;
    const reads = rels.slice(0, 8);
    for (const testRel of tests.slice(0, 2)) {
      if (procedures >= limit) break;
      const command = `node --test ${testRel}`;
      if (!isolatedVerifyRel(command, projectRoot)) continue;
      const files = [...new Set([...reads, testRel])];
      const fp = buildFingerprint({ files, verifyCommand: command, failureSignature: '' });
      const procedure = {
        actions: files.map((p) => ({ type: 'READ_FILE', path: p })),
        verify: [{ type: 'RUN', command }],
        _meta: { source: 'git-history', commit: String(c.hash).slice(0, 12), subject: String(c.subject || '').slice(0, 120) },
      };
      const evalPassed = evalProcedureVerify({ procedure, projectRoot }).ok === true;
      procedure._meta.eval_status = evalPassed ? 'evaluated' : 'unevaluated';
      promoteOrDemote({
        projectRoot: storeRoot,
        fingerprint: fp,
        procedure,
        evalPassed,
        humanApproved: false,
      });
      procedures++;
    }
  }

  return { ok: true, mined, procedures, storeRoot };
}

module.exports = { mineGitProcedures, isIsolatedTestPath };
