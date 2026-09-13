#!/usr/bin/env node
/**
 * Rewrite catalog-count marker blocks across docs.
 *
 * Marker convention:
 *   <!-- catalog-counts:start kind=<table|inline|total-line|short-total|badge-url> -->
 *   ...auto-generated content...
 *   <!-- catalog-counts:end -->
 *
 * Usage:
 *   node scripts/render-catalog-counts.cjs            # rewrite all targets
 *   node scripts/render-catalog-counts.cjs --check    # exit 1 if any target would change
 *   node scripts/render-catalog-counts.cjs --target <file>  # one file only
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  computeCatalogCounts,
  renderTable,
  renderInline,
  renderTotalBadge,
  renderBadgeLine,
  renderTotalLine,
  renderShortTotal,
} = require('./lib/catalog/counts.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const SUBAGENTS_ROOT = path.join(REPO_ROOT, 'agents', 'subagents');

const DEFAULT_TARGETS = [
  'README.md',
  'references/deferred/hypervisor-deferred.md',
  'AGENTS.md',
  'commands/subagent.md',
];

const MARKER_RE = /<!--\s*catalog-counts:start\s+kind=([\w-]+)\s*-->(\r?\n)?([\s\S]*?)(\r?\n)?<!--\s*catalog-counts:end\s*-->/g;

function renderForKind(kind, counts) {
  switch (kind) {
    case 'table': return renderTable(counts);
    case 'inline': return renderInline(counts);
    case 'badge-line': return renderBadgeLine(counts);
    case 'total-line': return renderTotalLine(counts);
    case 'short-total': return renderShortTotal(counts);
    case 'badge-url': return renderTotalBadge(counts);
    default: throw new Error(`Unknown catalog-counts kind: ${kind}`);
  }
}

function rewriteOne(filePath, counts) {
  if (!fs.existsSync(filePath)) {
    return { path: filePath, status: 'missing' };
  }
  const before = fs.readFileSync(filePath, 'utf8');
  MARKER_RE.lastIndex = 0;
  let touched = false;
  const after = before.replace(MARKER_RE, (_match, kind, leadingNl, _body, trailingNl) => {
    touched = true;
    const body = renderForKind(kind, counts);
    // Preserve the original single-line vs multi-line layout. If the source had a
    // newline immediately after :start and before :end, the rendered content lives on
    // its own line; otherwise it stays inline. Both forms render identically in HTML
    // but the inline form is required for parenthetical uses like "(138+ subagents)".
    const lead = leadingNl ? leadingNl : '';
    const trail = trailingNl ? trailingNl : '';
    return `<!-- catalog-counts:start kind=${kind} -->${lead}${body}${trail}<!-- catalog-counts:end -->`;
  });
  if (!touched) return { path: filePath, status: 'no-marker' };
  if (after === before) return { path: filePath, status: 'unchanged' };
  return { path: filePath, status: 'changed', after };
}

function parseArgs(argv) {
  const args = { check: false, targets: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') args.check = true;
    else if (a === '--target') args.targets.push(argv[++i]);
    else if (a === '--help' || a === '-h') {
      process.stdout.write(
        'Usage: node scripts/render-catalog-counts.cjs [--check] [--target <file>]\n'
      );
      process.exit(0);
    }
  }
  if (args.targets.length === 0) args.targets = DEFAULT_TARGETS;
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  const counts = computeCatalogCounts(SUBAGENTS_ROOT);
  let drift = false;
  let updates = 0;
  for (const rel of args.targets) {
    const abs = path.resolve(REPO_ROOT, rel);
    const result = rewriteOne(abs, counts);
    if (result.status === 'missing') {
      process.stderr.write(`MISSING: ${rel}\n`);
      drift = true;
      continue;
    }
    if (result.status === 'no-marker') {
      process.stderr.write(`NO-MARKER: ${rel} (no catalog-counts:start block found)\n`);
      drift = true;
      continue;
    }
    if (result.status === 'changed') {
      if (args.check) {
        process.stderr.write(`DRIFT: ${rel}\n`);
        drift = true;
      } else {
        fs.writeFileSync(abs, result.after);
        process.stdout.write(`UPDATED: ${rel}\n`);
        updates++;
      }
    } else {
      if (!args.check) process.stdout.write(`OK: ${rel}\n`);
    }
  }
  if (args.check && drift) {
    process.stderr.write('\nFix with: npm run catalog:counts\n');
    process.exit(1);
  }
  if (!args.check) {
    process.stdout.write(`\nTotal subagents: ${counts.total}\nUpdated ${updates} file(s).\n`);
  }
}

if (require.main === module) {
  try { main(); } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = { rewriteOne, renderForKind, parseArgs };
