#!/usr/bin/env node
'use strict';

/**
 * Fail on any static require/import cycle (ADR-016).
 *
 * Builds the relative-require graph of scripts/ and bin/ and reports strongly
 * connected components at two levels: files, and scripts/lib/<dir> modules.
 * Lazy requires inside functions count as edges. Non-literal requires cannot be
 * resolved statically and are not edges here.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOTS = ['scripts', 'bin'];
const EXTS = ['.cjs', '.js', '.mjs'];
const SPEC_RE = /(?:\brequire\s*\(\s*|\bimport\s*\(\s*|\bfrom\s+|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;

function listFiles(repoRoot) {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (EXTS.includes(path.extname(e.name))) out.push(p);
    }
  };
  for (const r of ROOTS) walk(path.join(repoRoot, r));
  return out.sort();
}

function resolveSpec(fromFile, spec, known) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, ...EXTS.map((x) => base + x), ...EXTS.map((x) => path.join(base, `index${x}`))];
  return candidates.find((c) => known.has(c)) || null;
}

function buildFileGraph(repoRoot) {
  const files = listFiles(repoRoot);
  const known = new Set(files);
  const graph = new Map();
  for (const f of files) {
    const deps = new Set();
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(SPEC_RE)) {
      const target = resolveSpec(f, m[1], known);
      if (target && target !== f) deps.add(target);
    }
    graph.set(f, deps);
  }
  return graph;
}

function moduleOf(repoRoot, file) {
  const parts = path.relative(repoRoot, file).split(path.sep);
  if (parts[0] === 'scripts' && parts[1] === 'lib' && parts.length > 3) return `scripts/lib/${parts[2]}`;
  return null;
}

function buildModuleGraph(repoRoot, fileGraph) {
  const graph = new Map();
  const witness = new Map();
  for (const [file, deps] of fileGraph) {
    const from = moduleOf(repoRoot, file);
    if (!from) continue;
    if (!graph.has(from)) graph.set(from, new Set());
    for (const dep of deps) {
      const to = moduleOf(repoRoot, dep);
      if (!to || to === from) continue;
      graph.get(from).add(to);
      const key = `${from} -> ${to}`;
      if (!witness.has(key)) witness.set(key, `${path.relative(repoRoot, file)} -> ${path.relative(repoRoot, dep)}`);
    }
  }
  return { graph, witness };
}

/** Tarjan's algorithm; returns components with more than one node. */
function cycles(graph) {
  let next = 0;
  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const found = [];
  const visit = (v) => {
    index.set(v, next);
    low.set(v, next);
    next++;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) || []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) found.push(comp.sort());
    }
  };
  for (const v of graph.keys()) if (!index.has(v)) visit(v);
  return found;
}

function findCycles(repoRoot) {
  const root = path.resolve(repoRoot);
  const fileGraph = buildFileGraph(root);
  const { graph: moduleGraph, witness } = buildModuleGraph(root, fileGraph);
  const rel = (f) => path.relative(root, f);
  const fileCycles = cycles(fileGraph).map((c) => c.map(rel));
  const moduleCycles = cycles(moduleGraph).map((members) => {
    const inside = new Set(members);
    const edges = [];
    for (const m of members) {
      for (const to of moduleGraph.get(m) || []) if (inside.has(to)) edges.push(witness.get(`${m} -> ${to}`));
    }
    return { members, edges: edges.sort() };
  });
  return { files: fileGraph.size, fileCycles, moduleCycles };
}

function main() {
  const repoRoot = process.argv[2] || path.join(__dirname, '..');
  const r = findCycles(repoRoot);
  if (!r.fileCycles.length && !r.moduleCycles.length) {
    console.log(`dependency-cycles: OK (${r.files} files, 0 file cycles, 0 module cycles)`);
    return;
  }
  console.error(`dependency-cycles: ${r.fileCycles.length} file cycle(s), ${r.moduleCycles.length} module cycle(s)`);
  for (const c of r.fileCycles) console.error(`  file cycle: ${c.join(', ')}`);
  for (const c of r.moduleCycles) {
    console.error(`  module cycle: ${c.members.join(', ')}`);
    for (const e of c.edges) console.error(`    ${e}`);
  }
  process.exit(1);
}

if (require.main === module) main();

module.exports = { findCycles };
