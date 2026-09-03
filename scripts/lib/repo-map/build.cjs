'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_IGNORE = new Set([
  'node_modules',
  '.git',
  '.worklogs',
  'dist',
  'build',
  'coverage',
  '.agentic-swe',
]);

const CODE_EXT = new Set(['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx']);

/** @typedef {{ file: string, symbols: string[], imports: string[], exports: string[] }} FileEntry */

/**
 * @param {string} dir
 * @param {Set<string>} ignore
 * @returns {string[]}
 */
function walkCodeFiles(dir, ignore = DEFAULT_IGNORE) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      const abs = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        if (ignore.has(ent.name)) continue;
        stack.push(abs);
      } else if (CODE_EXT.has(path.extname(ent.name))) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

/**
 * @param {string} body
 * @returns {string[]}
 */
function extractImports(body) {
  const imports = [];
  const re = [
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const r of re) {
    let m;
    while ((m = r.exec(body))) {
      imports.push(m[1]);
    }
  }
  return imports;
}

/**
 * @param {string} body
 * @returns {string[]}
 */
function extractExports(body) {
  const symbols = new Set();
  const patterns = [
    /module\.exports\s*=\s*\{([^}]+)\}/g,
    /module\.exports\s*=\s*([A-Za-z_$][\w$]*)/g,
    /exports\.([A-Za-z_$][\w$]*)\s*=/g,
    /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g,
    /export\s*\{\s*([^}]+)\s*\}/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(body))) {
      if (m[1] && m[1].includes(',')) {
        m[1].split(',').forEach((part) => {
          const name = part.trim().split(/\s+as\s+/)[0].trim();
          if (name && /^[A-Za-z_$]/.test(name)) symbols.add(name);
        });
      } else if (m[1]) {
        symbols.add(m[1].trim());
      }
    }
  }
  return [...symbols];
}

/**
 * @param {string} body
 * @returns {string[]}
 */
function extractFunctions(body) {
  const symbols = new Set();
  const patterns = [
    /function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/g,
    /class\s+([A-Za-z_$][\w$]*)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(body))) {
      symbols.add(m[1]);
    }
  }
  return [...symbols];
}

/**
 * Resolve relative import to repo-relative path when possible.
 * @param {string} fromFile abs path
 * @param {string} spec import specifier
 * @param {string} root abs project root
 * @returns {string|null}
 */
function resolveImport(fromFile, spec, root) {
  if (!spec.startsWith('.')) return null;
  const base = path.dirname(fromFile);
  const candidates = [
    spec,
    `${spec}.js`,
    `${spec}.cjs`,
    `${spec}.mjs`,
    `${spec}.ts`,
    path.join(spec, 'index.js'),
    path.join(spec, 'index.cjs'),
  ];
  for (const c of candidates) {
    const abs = path.resolve(base, c);
    if (fs.existsSync(abs)) {
      return path.relative(root, abs).replace(/\\/g, '/');
    }
  }
  return path.relative(root, path.resolve(base, spec)).replace(/\\/g, '/');
}

/**
 * @param {string} root project root
 * @returns {{ files: FileEntry[], symbolIndex: Map<string, string[]>, testsFor: Map<string, string[]> }}
 */
function buildRepoMap(root) {
  const absRoot = path.resolve(root);
  const files = walkCodeFiles(absRoot);
  /** @type {FileEntry[]} */
  const entries = [];
  /** @type {Map<string, string[]>} */
  const symbolIndex = new Map();
  /** @type {Map<string, string[]>} */
  const testsFor = new Map();

  for (const abs of files) {
    let body;
    try {
      body = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(absRoot, abs).replace(/\\/g, '/');
    const exports = extractExports(body);
    const fns = extractFunctions(body);
    const symbols = [...new Set([...exports, ...fns])];
    const rawImports = extractImports(body);
    const imports = rawImports
      .map((s) => resolveImport(abs, s, absRoot))
      .filter(Boolean);

    entries.push({ file: rel, symbols, imports, exports });
    for (const sym of symbols) {
      if (!symbolIndex.has(sym)) symbolIndex.set(sym, []);
      symbolIndex.get(sym).push(rel);
    }
  }

  const testFiles = entries.filter((e) => /(^|\/)test\//.test(e.file) || /\.test\.(js|cjs|mjs|ts)$/.test(e.file));
  for (const tf of testFiles) {
    let body;
    try {
      body = fs.readFileSync(path.join(absRoot, tf.file), 'utf8');
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.file === tf.file) continue;
      const base = path.basename(ent.file, path.extname(ent.file));
      if (body.includes(ent.file) || body.includes(base)) {
        if (!testsFor.has(ent.file)) testsFor.set(ent.file, []);
        if (!testsFor.get(ent.file).includes(tf.file)) testsFor.get(ent.file).push(tf.file);
      }
    }
  }

  return { files: entries, symbolIndex, testsFor };
}

module.exports = {
  buildRepoMap,
  walkCodeFiles,
  extractImports,
  extractExports,
  resolveImport,
};
