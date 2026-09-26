#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { estimateContext } = require('./lib/context-budget/estimate.cjs');
const { readManifest } = require('./lib/install-state/manifest.cjs');
const { resolveProfile } = require('./lib/install-state/profiles.cjs');
const { loadJevConfig, envDisabled } = require('./lib/jev/config.cjs');
const { discoverActiveWorkDir } = require('./lib/work-engine/discover-workdir.cjs');

const packRoot = path.resolve(__dirname, '..');

const FIXED_JEV_SESSION_HINT =
  'Jev advisory session hints may load on session start when enabled (track, tier, skill routing).';

function capState(text, max) {
  const s = String(text ?? '');
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : s.length;
  if (s.length <= limit) return s;
  return s.slice(0, limit);
}

function parseArgs(argv) {
  const opts = { target: process.cwd(), json: false, profile: null, withCapabilities: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target' && argv[i + 1]) opts.target = path.resolve(argv[++i]);
    else if (arg === '--profile' && argv[i + 1]) opts.profile = argv[++i];
    else if (arg === '--with' && argv[i + 1]) opts.withCapabilities.push(argv[++i]);
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return opts;
}

function classifyKind(relativePath) {
  const norm = relativePath.split(path.sep).join('/');
  if (norm === 'CLAUDE.md' || norm === 'AGENTS.md' || norm === 'GEMINI.md') return 'policy';
  if (norm.startsWith('agents/') && norm.endsWith('.md')) return 'agent-description';
  if (norm.startsWith('skills/') && norm.endsWith('.md')) return 'skill';
  if (norm === 'mcp.json' || norm === '.mcp.json') return 'mcp';
  if (/\.md$/i.test(norm) && (
    norm.startsWith('commands/')
    || norm.startsWith('phases/')
    || norm.startsWith('references/')
    || norm.startsWith('templates/')
  )) return 'policy';
  return null;
}

function contentForKind(kind, content) {
  if (kind !== 'agent-description') return content;
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? match[1] : content;
}

function profileIncludesJev(entries) {
  return entries.some(
    (entry) => entry === 'config/jev.default.json'
      || entry === 'scripts/lib/jev'
      || entry.startsWith('scripts/lib/jev/'),
  );
}

function addInventoryFile(files, seen, packRoot, relativePath) {
  const norm = relativePath.split(path.sep).join('/');
  if (seen.has(norm)) return;
  const full = path.join(packRoot, relativePath);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return;
  const kind = classifyKind(norm);
  if (!kind) return;
  seen.add(norm);
  const raw = fs.readFileSync(full, 'utf8');
  files.push({ path: norm, content: contentForKind(kind, raw), kind });
}

function walkInventoryEntry(packRoot, entry, files, seen) {
  const full = path.join(packRoot, entry);
  if (!fs.existsSync(full)) return;
  if (fs.statSync(full).isFile()) {
    addInventoryFile(files, seen, packRoot, entry);
    return;
  }
  function walk(dir, prefix) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules' || ent.name === '.git') continue;
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const child = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(child, rel);
      else addInventoryFile(files, seen, packRoot, rel);
    }
  }
  walk(full, entry);
}

function buildFileInventory({ packRoot: root, target, profile, withCapabilities }) {
  const entries = resolveProfile({
    profile,
    withCapabilities,
    packRoot: root,
  });
  const files = [];
  const seen = new Set();
  for (const entry of entries) {
    walkInventoryEntry(root, entry, files, seen);
  }
  for (const name of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
    const full = path.join(target, name);
    if (!fs.existsSync(full)) continue;
    const kind = 'policy';
    if (seen.has(name)) {
      const idx = files.findIndex((file) => file.path === name);
      if (idx >= 0) files[idx].content = fs.readFileSync(full, 'utf8');
      continue;
    }
    seen.add(name);
    files.push({ path: name, content: fs.readFileSync(full, 'utf8'), kind });
  }
  for (const name of ['mcp.json', '.mcp.json']) {
    const full = path.join(target, name);
    if (!fs.existsSync(full)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    files.push({ path: name, content: fs.readFileSync(full, 'utf8'), kind: 'mcp' });
  }
  return { entries, files };
}

function resolveProfileSelection(target, opts) {
  const destination = path.join(target, '.agentic-swe');
  const manifest = readManifest(destination);
  const profile = opts.profile || manifest?.profile || 'core';
  return { profile, withCapabilities: opts.withCapabilities || [] };
}

function fixedJevHintText(entries, env) {
  if (envDisabled(env)) return '';
  if (!profileIncludesJev(entries)) return '';
  return FIXED_JEV_SESSION_HINT;
}

function jevTaskTextForTarget(target, root, env) {
  const workDir = process.env.AGENTIC_SWE_WORK_DIR
    ? path.resolve(process.env.AGENTIC_SWE_WORK_DIR)
    : discoverActiveWorkDir(target);
  if (!workDir || !fs.existsSync(path.join(workDir, 'state.json'))) return '';
  let state;
  try {
    state = JSON.parse(fs.readFileSync(path.join(workDir, 'state.json'), 'utf8'));
  } catch {
    return '';
  }
  const task = typeof state.task === 'string' ? state.task : '';
  if (!task.trim()) return '';
  let config;
  try {
    config = loadJevConfig(root, target, env);
  } catch {
    return capState(task, 4000);
  }
  const cap = config.state_cap?.routing ?? 4000;
  return capState(task, cap);
}

function topComponentLines(components, limit = 3) {
  return Object.entries(components)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, tokens]) => ({ name, tokens }));
}

function topSavingsLines(savings, limit = 3) {
  return [...savings]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, limit);
}

function runContextBudget(opts, context = {}) {
  const env = context.env || process.env;
  const root = context.packRoot || packRoot;
  const target = path.resolve(opts.target);
  const { profile, withCapabilities } = resolveProfileSelection(target, opts);
  const { entries, files } = buildFileInventory({
    packRoot: root,
    target,
    profile,
    withCapabilities,
  });
  const jevHintText = fixedJevHintText(entries, env);
  const jevTaskText = jevTaskTextForTarget(target, root, env);
  const estimate = estimateContext({ files, jevHintText, jevTaskText });
  return {
    target,
    profile,
    withCapabilities,
    ...estimate,
    topComponents: topComponentLines(estimate.components),
    topSavings: topSavingsLines(estimate.savings),
  };
}

function printHuman(report) {
  console.log(`Context budget: ${report.target}`);
  console.log(`Profile: ${report.profile}`);
  console.log(`Total (always-loaded estimate): ${report.total}`);
  console.log(`Jev task text (separate): ${report.jevTaskText}`);
  console.log('Components:');
  for (const [name, tokens] of Object.entries(report.components)) {
    console.log(`- ${name}: ${tokens}`);
  }
  console.log('Largest components:');
  for (const row of report.topComponents) {
    console.log(`- ${row.name}: ${row.tokens}`);
  }
  if (report.topSavings.length) {
    console.log('Savings opportunities:');
    for (const row of report.topSavings) {
      console.log(`- ${row.action} (~${row.tokens} tokens)`);
    }
  }
}

function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
      console.log(`Usage: agentic-swe context-budget [--target <repo>] [--profile <name>] [--with <capability>] [--json]`);
      return;
    }
    const report = runContextBudget(opts);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHuman(report);
    }
  } catch (error) {
    process.stderr.write(`error: ${error.message || error}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
else module.exports = {
  buildFileInventory,
  runContextBudget,
  parseArgs,
  classifyKind,
  fixedJevHintText,
};
