'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildFingerprint } = require('./fingerprint.cjs');
const { promoteOrDemote } = require('./promotion.cjs');
const { evalProcedureVerify } = require('./procedure-eval.cjs');

const SCRIPT_NAMES = ['test', 'verify', 'test:smoke', 'ci'];

/**
 * Learn verify rituals from the repo's package.json (how this team actually tests).
 * Unevaluated unless the script is an isolated `node test/…` file that exits 0.
 *
 * @param {{ projectRoot: string, pluginRoot?: string, limit?: number }} opts
 */
function mineRepoRituals(opts) {
  const projectRoot = path.resolve(opts.projectRoot);
  const pkgPath = path.join(projectRoot, 'package.json');
  if (!fs.existsSync(pkgPath)) return { ok: true, mined: 0, procedures: 0 };

  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return { ok: false, mined: 0, procedures: 0, error: 'invalid package.json' };
  }

  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  const candidates = [];
  for (const name of SCRIPT_NAMES) {
    const command = String(scripts[name] || '').trim();
    if (!command || command.length > 160) continue;
    if (/password|secret|token|api[_-]?key/i.test(command)) continue;
    candidates.push({ name, command });
  }

  const limit = opts.limit || 8;
  let procedures = 0;
  for (const { name, command } of candidates.slice(0, limit)) {
    const files = ['package.json'];
    const fp = buildFingerprint({ files, verifyCommand: command, failureSignature: '' });
    const procedure = {
      actions: [],
      verify: [{ type: 'RUN', command }],
      _meta: { source: 'repo-ritual', script: name },
    };
    const rel = command.replace(/^node\s+/, '').trim().split(/\s/)[0];
    const isolated = /^node\s+test\//.test(command) && fs.existsSync(path.resolve(projectRoot, rel));
    let evalPassed = false;
    if (isolated) {
      evalPassed = evalProcedureVerify({ procedure, projectRoot }).ok === true;
    }
    procedure._meta.eval_status = evalPassed ? 'evaluated' : 'unevaluated';
    promoteOrDemote({
      projectRoot,
      fingerprint: fp,
      procedure,
      evalPassed,
      humanApproved: false,
    });
    procedures++;
  }

  return { ok: true, mined: candidates.length, procedures };
}

module.exports = { mineRepoRituals, SCRIPT_NAMES };
