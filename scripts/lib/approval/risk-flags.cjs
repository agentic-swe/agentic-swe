'use strict';

/**
 * Risk flags for the approval-wait human gate (OWASP ASI09).
 * Flags are review prompts for the human, not verdicts: a flagged diff can be fine,
 * and an unflagged diff is not proven safe.
 */

const { spawnSync } = require('node:child_process');

const SECURITY_PATH_PATTERNS = [
  { re: /(^|\/)(auth|authn|authz|security|crypto|secrets?|credentials?|oauth|sso|iam)(\/|\.|_|-|$)/i, detail: 'auth / security / crypto area' },
  { re: /(^|\/)\.env(\.|$)/i, detail: 'environment file' },
  { re: /\.(pem|key|p12|pfx|jks|keystore)$/i, detail: 'key or certificate material' },
  { re: /(^|\/)\.github\/workflows\//, detail: 'CI workflow' },
  { re: /(^|\/)hooks\//, detail: 'hook script' },
  { re: /(^|\/)CODEOWNERS$/, detail: 'code ownership' },
  { re: /(^|\/)(\.agentic-swe\/policy|config\/default-policy)\.json$/, detail: 'agentic-swe policy' },
  { re: /(^|\/)Dockerfile[^/]*$/, detail: 'container build' },
  { re: /(^|\/)\.claude\/settings(\.local)?\.json$/, detail: 'agent host settings' },
];

const DEP_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function parseUnifiedDiff(text) {
  const files = [];
  let cur = null;
  let inHunk = false;
  for (const line of String(text || '').split('\n')) {
    const head = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (head) {
      cur = { path: head[2], oldPath: head[1], status: 'modified', oldMode: null, newMode: null, added: [], removed: [] };
      files.push(cur);
      inHunk = false;
      continue;
    }
    if (!cur) continue;
    if (!inHunk) {
      let m;
      if ((m = /^new file mode (\d+)/.exec(line))) {
        cur.status = 'added';
        cur.newMode = m[1];
      } else if ((m = /^deleted file mode (\d+)/.exec(line))) {
        cur.status = 'deleted';
        cur.oldMode = m[1];
      } else if ((m = /^old mode (\d+)/.exec(line))) cur.oldMode = m[1];
      else if ((m = /^new mode (\d+)/.exec(line))) cur.newMode = m[1];
      else if (/^rename (from|to) /.test(line)) cur.status = 'renamed';
      else if (line.startsWith('@@')) inHunk = true;
      continue;
    }
    if (line.startsWith('@@')) continue;
    if (line.startsWith('+')) cur.added.push(line.slice(1));
    else if (line.startsWith('-')) cur.removed.push(line.slice(1));
  }
  return files;
}

function depKeys(jsonText) {
  if (!jsonText) return new Map();
  let obj;
  try {
    obj = JSON.parse(jsonText);
  } catch {
    return new Map();
  }
  const out = new Map();
  for (const section of DEP_SECTIONS) {
    for (const name of Object.keys((obj && obj[section]) || {})) out.set(`${section}:${name}`, { name, section });
  }
  return out;
}

function requirementName(line) {
  const t = line.trim();
  if (!t || t.startsWith('#') || t.startsWith('-')) return null;
  const m = /^([A-Za-z0-9_.-]+)/.exec(t);
  return m ? m[1].toLowerCase() : null;
}

function goModuleName(line) {
  const m = /^\s*(?:require\s+)?([\w.-]+\.[\w.\-/]+)\s+v\d/.exec(line);
  return m ? m[1] : null;
}

function newNames(file, nameOf) {
  const before = new Set(file.removed.map(nameOf).filter(Boolean));
  return [...new Set(file.added.map(nameOf).filter(Boolean))].filter((n) => !before.has(n));
}

function dependencyFlags(file, manifests) {
  const base = file.path.split('/').pop();
  if (base === 'package.json') {
    const m = manifests && manifests[file.path];
    if (m) {
      const before = depKeys(m.before);
      return [...depKeys(m.after)]
        .filter(([k]) => !before.has(k))
        .map(([, v]) => `${v.name} (${v.section})`);
    }
    return newNames(file, (l) => {
      const km = /^\s*"([^"]+)"\s*:\s*"/.exec(l);
      return km ? km[1] : null;
    }).map((n) => `${n} (from diff; verify section)`);
  }
  if (/^requirements.*\.txt$/.test(base)) return newNames(file, requirementName);
  if (base === 'go.mod') return newNames(file, goModuleName);
  return [];
}

function permissionDetails(file) {
  const details = [];
  const changed = [...file.added, ...file.removed];
  const isExec = (mode) => /755$/.test(mode || '');
  if (isExec(file.newMode) && !isExec(file.oldMode)) details.push('executable bit set');
  if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(file.path) &&
      changed.some((l) => /^\s*permissions\s*:|^\s*[a-z-]+\s*:\s*(write|read|none)\s*$/.test(l))) {
    details.push('workflow token permissions changed');
  }
  if (/(^|\/)\.claude\/settings(\.local)?\.json$/.test(file.path) &&
      changed.some((l) => /"(allow|deny|ask|permissions|defaultMode)"/.test(l))) {
    details.push('agent host permission rules changed');
  }
  if (/(^|\/)agents\/.+\.md$/.test(file.path) &&
      changed.some((l) => /^(tools|allowed-tools|allowed_tools)\s*:/.test(l))) {
    details.push('agent tool grant changed');
  }
  if (/(^|\/)CODEOWNERS$/.test(file.path)) details.push('code ownership changed');
  if (/(^|\/)(\.agentic-swe\/policy|config\/default-policy)\.json$/.test(file.path)) details.push('policy changed');
  return details;
}

/**
 * @param {ReturnType<typeof parseUnifiedDiff>} files
 * @param {{ manifests?: Record<string, { before: string|null, after: string|null }>, extraSecurityPatterns?: RegExp[] }} [opts]
 */
function computeRiskFlags(files, opts = {}) {
  const patterns = [
    ...SECURITY_PATH_PATTERNS,
    ...(opts.extraSecurityPatterns || []).map((re) => ({ re, detail: 'repo-configured sensitive path' })),
  ];
  const flags = [];
  for (const file of files) {
    const hit = patterns.find((p) => p.re.test(file.path) || p.re.test(file.oldPath || ''));
    if (hit) flags.push({ kind: 'security_sensitive_path', path: file.path, detail: hit.detail });
    for (const dep of dependencyFlags(file, opts.manifests)) {
      flags.push({ kind: 'new_dependency', path: file.path, detail: dep });
    }
    for (const d of permissionDetails(file)) flags.push({ kind: 'permission_change', path: file.path, detail: d });
  }
  const counts = { security_sensitive_path: 0, new_dependency: 0, permission_change: 0 };
  for (const f of flags) counts[f.kind] += 1;
  let level = 'none';
  if (flags.length) {
    level =
      counts.permission_change > 0 || (counts.new_dependency > 0 && counts.security_sensitive_path > 0)
        ? 'high'
        : 'review';
  }
  return { level, counts, flags, files_changed: files.length };
}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: (r.stderr || '').trim() };
}

/**
 * Diff `base...head` in a git checkout and compute risk flags.
 * @param {{ cwd: string, base?: string, head?: string, extraSecurityPatterns?: RegExp[] }} opts
 */
function collectRiskFlags(opts) {
  const cwd = opts.cwd;
  const baseRef = opts.base || 'origin/main';
  const headRef = opts.head || 'HEAD';
  const fail = (message) => ({ ok: false, code: 'GIT_DIFF_FAILED', message });
  const base = git(cwd, ['rev-parse', '--verify', `${baseRef}^{commit}`]);
  if (!base.ok) return fail(`cannot resolve base ${baseRef}: ${base.stderr}`);
  const head = git(cwd, ['rev-parse', '--verify', `${headRef}^{commit}`]);
  if (!head.ok) return fail(`cannot resolve head ${headRef}: ${head.stderr}`);
  const mb = git(cwd, ['merge-base', base.stdout.trim(), head.stdout.trim()]);
  if (!mb.ok) return fail(`no merge base for ${baseRef} and ${headRef}`);
  const mergeBase = mb.stdout.trim();
  const diff = git(cwd, ['diff', '-M', '--no-color', '--no-ext-diff', mergeBase, head.stdout.trim()]);
  if (!diff.ok) return fail(`git diff failed: ${diff.stderr}`);
  const files = parseUnifiedDiff(diff.stdout);
  const manifests = {};
  for (const f of files) {
    if (f.path.split('/').pop() !== 'package.json') continue;
    const before = f.status === 'added' ? null : git(cwd, ['show', `${mergeBase}:${f.oldPath}`]);
    const after = f.status === 'deleted' ? null : git(cwd, ['show', `${head.stdout.trim()}:${f.path}`]);
    manifests[f.path] = {
      before: before && before.ok ? before.stdout : null,
      after: after && after.ok ? after.stdout : null,
    };
  }
  return {
    ok: true,
    base: base.stdout.trim(),
    base_ref: baseRef,
    merge_base: mergeBase,
    head: head.stdout.trim(),
    ...computeRiskFlags(files, { manifests, extraSecurityPatterns: opts.extraSecurityPatterns }),
  };
}

function formatRiskFlags(r) {
  const lines = [`Risk level: ${r.level.toUpperCase()} (${r.files_changed} files changed)`];
  const labels = {
    security_sensitive_path: 'Security-sensitive paths',
    new_dependency: 'New dependencies',
    permission_change: 'Permission changes',
  };
  for (const kind of Object.keys(labels)) {
    const items = r.flags.filter((f) => f.kind === kind);
    lines.push(`${labels[kind]}: ${items.length}`);
    for (const f of items) lines.push(`  - ${f.path} — ${f.detail}`);
  }
  return lines.join('\n');
}

module.exports = {
  SECURITY_PATH_PATTERNS,
  parseUnifiedDiff,
  computeRiskFlags,
  collectRiskFlags,
  formatRiskFlags,
};
