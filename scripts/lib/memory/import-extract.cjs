'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CODE_EXTS = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx']);

/**
 * @param {string} content
 * @returns {string[]}
 */
function extractImportSpecifiers(content) {
  const out = new Set();
  const lines = content.split(/\r?\n/);
  for (let line of lines) {
    const cut = line.indexOf('//');
    if (cut >= 0) line = line.slice(0, cut);
    const t = line.trim();
    if (!t || t.startsWith('//')) continue;

    let m;
    const req = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = req.exec(t)) !== null) {
      if (m[1]) out.add(m[1]);
    }
    m = t.match(/^import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/);
    if (m && m[1]) out.add(m[1]);
    m = t.match(/^import\s*\(\s*['"]([^'"]+)['"]\s*\)/);
    if (m && m[1]) out.add(m[1]);
    m = t.match(/^export\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/);
    if (m && m[1]) out.add(m[1]);
  }
  return [...out];
}

/**
 * @param {string} projectRoot
 * @param {string} fromFileAbs absolute path to source file
 * @param {string} specifier import string
 * @returns {{ type: 'relative', path: string } | { type: 'npm', name: string } | null}
 */
function classifyImport(projectRoot, fromFileAbs, specifier) {
  if (!specifier || specifier.startsWith('node:')) return null;
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    const fromDir = path.dirname(fromFileAbs);
    const joined = path.normalize(path.join(fromDir, specifier));
    const rel = path.relative(projectRoot, joined);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return { type: 'relative', path: rel.split(path.sep).join('/') };
  }
  const name = npmPackageNameFromSpecifier(specifier);
  if (name) return { type: 'npm', name };
  return null;
}

/**
 * Bare specifier → npm package name (first path segment for scoped).
 * @param {string} spec
 */
function npmPackageNameFromSpecifier(spec) {
  const s = spec.replace(/\\/g, '/');
  if (s.startsWith('@')) {
    const parts = s.split('/');
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    return s;
  }
  return s.split('/')[0] || null;
}

/**
 * Resolve a relative import specifier from a source file to a project-relative file path.
 * @param {string} projectRoot
 * @param {string} fromFileAbs
 * @param {string} specifier e.g. `./b` or `../x`
 * @returns {string | null} posix path under project
 */
function resolveRelativeModuleFile(projectRoot, fromFileAbs, specifier) {
  const fromDir = path.dirname(fromFileAbs);
  const joined = path.normalize(path.join(fromDir, specifier));
  const relToProj = path.relative(projectRoot, joined);
  if (relToProj.startsWith('..') || path.isAbsolute(relToProj)) return null;
  const base = joined;
  const candidates = [
    base,
    base + '.js',
    base + '.cjs',
    base + '.mjs',
    base + '.ts',
    base + '.tsx',
    path.join(base, 'index.js'),
    path.join(base, 'index.ts'),
    path.join(base, 'index.cjs'),
  ];
  for (const c of candidates) {
    try {
      const st = fs.statSync(c);
      if (st.isFile()) {
        const rel = path.relative(projectRoot, c);
        return rel.split(path.sep).join('/');
      }
    } catch {
      /* missing */
    }
  }
  return null;
}

/**
 * @param {string} relPath
 * @returns {string} file:<posix>
 */
function fileNodeId(relPath) {
  return `file:${relPath.split(path.sep).join('/')}`;
}

/**
 * @param {string} pkgName
 */
function npmNodeId(pkgName) {
  return `npm:${pkgName}`;
}

/**
 * @param {string} manifestRel posix
 */
function manifestNodeId(manifestRel) {
  return `manifest:${manifestRel}`;
}

function isCodeFile(name) {
  const ext = path.extname(name).toLowerCase();
  return CODE_EXTS.has(ext);
}

module.exports = {
  extractImportSpecifiers,
  classifyImport,
  resolveRelativeModuleFile,
  npmPackageNameFromSpecifier,
  fileNodeId,
  npmNodeId,
  manifestNodeId,
  isCodeFile,
  CODE_EXTS,
};
