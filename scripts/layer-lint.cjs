#!/usr/bin/env node
'use strict';

/**
 * ADR-016 layer lint: every scripts/lib/<dir> is mapped, static edges never go
 * upward / forbidden, and non-literal require() sites are allow-listed.
 * Zero third-party deps — uses the same require-graph style as dependency-cycles.cjs.
 */

const fs = require('node:fs');
const path = require('node:path');

const EXTS = ['.cjs', '.js', '.mjs'];
const SPEC_RE = /(?:\brequire\s*\(\s*|\bimport\s*\(\s*|\bfrom\s+|\bimport\s+)['"](\.{1,2}\/[^'"]+)['"]/g;
const NON_LITERAL_REQUIRE_RE = /\brequire\s*\(\s*(?!['"]).+?\)/g;

function listLibDirs(repoRoot) {
  const lib = path.join(repoRoot, 'scripts', 'lib');
  return fs.readdirSync(lib, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

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
  walk(path.join(repoRoot, 'scripts'));
  walk(path.join(repoRoot, 'bin'));
  return out.sort();
}

function resolveSpec(fromFile, spec, known) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [base, ...EXTS.map((x) => base + x), ...EXTS.map((x) => path.join(base, `index${x}`))];
  return candidates.find((c) => known.has(c)) || null;
}

function moduleOf(repoRoot, file) {
  const parts = path.relative(repoRoot, file).split(path.sep);
  if (parts[0] === 'scripts' && parts[1] === 'lib' && parts.length > 3) return parts[2];
  return null;
}

function loadLayers(repoRoot) {
  const file = path.join(repoRoot, 'config', 'layers.json');
  if (!fs.existsSync(file)) {
    return { ok: false, errors: [`missing ${path.relative(repoRoot, file)}`] };
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { ok: false, errors: [`config/layers.json is not valid JSON: ${e.message}`] };
  }
  if (!doc || typeof doc.modules !== 'object' || !doc.layers) {
    return { ok: false, errors: ['config/layers.json must define layers and modules'] };
  }
  return { ok: true, doc, file };
}

function lintLayers(repoRoot) {
  const root = path.resolve(repoRoot);
  const loaded = loadLayers(root);
  if (!loaded.ok) return loaded;
  const { doc } = loaded;
  const errors = [];
  const rank = doc.layers;
  const modules = doc.modules;
  const forbidden = new Set((doc.forbidden || []).map((f) => `${f.from}->${f.to}`));
  const allow = new Set((doc.dynamic_allowlist || []).map((e) => e.file));

  for (const dir of listLibDirs(root)) {
    if (!Object.prototype.hasOwnProperty.call(modules, dir)) {
      errors.push(`scripts/lib/${dir} is not mapped in config/layers.json#modules`);
    } else if (!rank[modules[dir]]) {
      errors.push(`scripts/lib/${dir} maps to unknown layer "${modules[dir]}"`);
    }
  }
  for (const dir of Object.keys(modules)) {
    if (!fs.existsSync(path.join(root, 'scripts', 'lib', dir))) {
      errors.push(`config/layers.json maps missing scripts/lib/${dir}`);
    }
  }

  const files = listFiles(root);
  const known = new Set(files);
  for (const file of files) {
    const rel = path.relative(root, file).split(path.sep).join('/');
    const src = fs.readFileSync(file, 'utf8');
    const fromMod = moduleOf(root, file);
    for (const m of src.matchAll(SPEC_RE)) {
      const target = resolveSpec(file, m[1], known);
      if (!target) continue;
      const toMod = moduleOf(root, target);
      if (!fromMod || !toMod || fromMod === toMod) continue;
      const fromLayer = modules[fromMod];
      const toLayer = modules[toMod];
      if (!fromLayer || !toLayer) continue;
      if (forbidden.has(`${fromLayer}->${toLayer}`)) {
        errors.push(`forbidden edge ${fromMod}(${fromLayer}) -> ${toMod}(${toLayer}) via ${rel}`);
        continue;
      }
      if (rank[toLayer] < rank[fromLayer]) {
        errors.push(`upward edge ${fromMod}(${fromLayer}/${rank[fromLayer]}) -> ${toMod}(${toLayer}/${rank[toLayer]}) via ${rel}`);
      }
    }
    // Dynamic-require allowlist applies to scripts/lib (ADR-016 layer membership).
    if (!rel.startsWith('scripts/lib/')) continue;
    for (const m of src.matchAll(NON_LITERAL_REQUIRE_RE)) {
      const snippet = m[0].replace(/\s+/g, ' ');
      if (/require\s*\(\s*path\.join\s*\(/.test(snippet) || /require\s*\(\s*[A-Za-z_$]/.test(snippet)) {
        if (!allow.has(rel)) {
          errors.push(`non-literal require in ${rel} is not in config/layers.json#dynamic_allowlist: ${snippet.slice(0, 80)}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, modules: Object.keys(modules).length };
}

function main() {
  const root = process.cwd();
  const result = lintLayers(root);
  if (!result.ok) {
    console.error('layer-lint: FAIL');
    for (const e of result.errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`layer-lint: OK (${result.modules} modules, dynamic requires allow-listed)`);
}

if (require.main === module) main();

module.exports = { lintLayers, loadLayers };
