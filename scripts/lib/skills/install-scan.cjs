'use strict';

/**
 * AE-027b: static artifact / dependency scanning at skill/plugin install.
 * Layer: skills (service). Must not import scripts/lib/tools (ADR-016).
 *
 * Fail-closed: corrupt trees, escaping symlinks, lifecycle scripts, and
 * known malicious fixture patterns refuse install.
 */

const fs = require('node:fs');
const path = require('node:path');

const LIFECYCLE_FILES = new Set([
  'postinstall.js',
  'preinstall.js',
  'install.js',
  'postinstall.cjs',
  'preinstall.cjs',
  'install.cjs',
]);

/** Patterns that malicious fixtures use to steal secrets / beacon / loop. */
const MALICIOUS_CONTENT = [
  { id: 'env-stealer', re: /process\.env\.(GITHUB_TOKEN|NPM_TOKEN|GH_TOKEN|NODE_AUTH_TOKEN)/ },
  { id: 'network-beacon', re: /\b(?:fetch|http\.request|https\.request|net\.connect)\s*\(/ },
  { id: 'forever-spawn', re: /while\s*\(\s*true\s*\)[\s\S]{0,200}\bspawn(?:Sync)?\s*\(/ },
  { id: 'shell-true', re: /shell\s*:\s*true\b/ },
];

/**
 * @param {string} root
 * @returns {{ ok: true, findings: object[] } | { ok: false, code: string, findings: object[], message: string }}
 */
function scanInstallPackage(root) {
  if (root == null || typeof root !== 'string' || !String(root).trim()) {
    return {
      ok: false,
      code: 'SCAN_ROOT_INVALID',
      findings: [],
      message: 'scan root is required',
    };
  }
  let rootAbs;
  try {
    rootAbs = fs.realpathSync(path.resolve(root));
  } catch (err) {
    return {
      ok: false,
      code: 'SCAN_ROOT_MISSING',
      findings: [],
      message: err && err.message ? err.message : 'scan root missing',
    };
  }
  if (!fs.statSync(rootAbs).isDirectory()) {
    return {
      ok: false,
      code: 'SCAN_ROOT_INVALID',
      findings: [],
      message: 'scan root must be a directory',
    };
  }

  const findings = [];
  const stack = [rootAbs];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return {
        ok: false,
        code: 'SCAN_READ_FAILED',
        findings,
        message: err && err.message ? err.message : 'readdir failed',
      };
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) {
        let target;
        try {
          target = fs.realpathSync(full);
        } catch {
          findings.push({
            id: 'symlink-unresolved',
            path: path.relative(rootAbs, full),
            message: 'symlink could not be resolved',
          });
          continue;
        }
        if (target !== rootAbs && !target.startsWith(`${rootAbs}${path.sep}`)) {
          findings.push({
            id: 'symlink-escape',
            path: path.relative(rootAbs, full),
            target,
            message: 'symlink escapes package root',
          });
        }
        continue;
      }
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (LIFECYCLE_FILES.has(ent.name)) {
        findings.push({
          id: 'lifecycle-script',
          path: path.relative(rootAbs, full),
          message: `lifecycle script ${ent.name} is forbidden`,
        });
      }
      if (ent.name === 'package.json') {
        try {
          const pkg = JSON.parse(fs.readFileSync(full, 'utf8'));
          if (pkg && pkg.scripts && typeof pkg.scripts === 'object' && Object.keys(pkg.scripts).length) {
            findings.push({
              id: 'package-scripts',
              path: path.relative(rootAbs, full),
              message: 'package.json scripts are forbidden at install',
            });
          }
        } catch {
          findings.push({
            id: 'package-json-corrupt',
            path: path.relative(rootAbs, full),
            message: 'package.json is corrupt',
          });
        }
      }
      if (!/\.(cjs|js|mjs|sh|bash|zsh)$/i.test(ent.name)) continue;
      let text;
      try {
        text = fs.readFileSync(full, 'utf8');
      } catch (err) {
        return {
          ok: false,
          code: 'SCAN_READ_FAILED',
          findings,
          message: err && err.message ? err.message : 'read failed',
        };
      }
      for (const rule of MALICIOUS_CONTENT) {
        if (rule.re.test(text)) {
          findings.push({
            id: rule.id,
            path: path.relative(rootAbs, full),
            message: `matched malicious pattern ${rule.id}`,
          });
        }
      }
    }
  }

  if (findings.length) {
    return {
      ok: false,
      code: 'SCAN_FAILED',
      findings,
      message: `install scan failed with ${findings.length} finding(s)`,
    };
  }
  return { ok: true, findings: [] };
}

module.exports = {
  LIFECYCLE_FILES,
  MALICIOUS_CONTENT,
  scanInstallPackage,
};
