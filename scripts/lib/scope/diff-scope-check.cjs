'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Extract declared file list from implementation.md.
 * Looks for file paths in markdown table rows or list items.
 * Returns a Set of normalized paths.
 */
function addDeclaredPath(paths, raw) {
  if (!raw) return;
  const p = String(raw)
    .trim()
    .replace(/^\//, '')
    .replace(/\\/g, '/')
    .replace(/[,;]+$/, '');
  if (!p || p.includes('://') || p.startsWith('http') || p.startsWith('#')) return;
  if (p.includes('/') || /\.(cjs|mjs|js|ts|tsx|jsx|json|md|yml|yaml)$/i.test(p)) {
    paths.add(p);
  }
}

function extractDeclaredFiles(implementationMdPath) {
  if (!fs.existsSync(implementationMdPath)) {
    return null;
  }
  const content = fs.readFileSync(implementationMdPath, 'utf8');
  const paths = new Set();

  const patterns = [
    /\|\s*`?([^\s|`]+\.[a-zA-Z]+)`?\s*\|/g,
    /[-*]\s+`?([^\s`]+\.[a-zA-Z]+)`?/g,
    /^\s*\d+\.\s+`([^`]+)`/gm,
    /`([A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+)`/g,
    /(?:^|\s)([a-zA-Z][\w/./-]*\.[a-zA-Z]{1,10})(?:\s|$|:|\))/gm,
  ];

  for (const pat of patterns) {
    let match;
    while ((match = pat.exec(content)) !== null) {
      addDeclaredPath(paths, match[1]);
    }
  }

  const holdout = content.matchAll(/`(mined|ritual|oracle)-[a-z0-9-]+`/gi);
  for (const m of holdout) {
    paths.add(m[0].slice(1, -1));
  }
  return paths;
}

/**
 * Get list of files changed in git diff (staged + unstaged).
 */
function getChangedFiles(repoRoot) {
  try {
    const staged = execSync('git diff --cached --name-only', {
      cwd: repoRoot, encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);
    const unstaged = execSync('git diff --name-only', {
      cwd: repoRoot, encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);
    return [...new Set([...staged, ...unstaged])];
  } catch {
    return [];
  }
}

/**
 * Compare actual diff against declared files.
 * Returns { ok, undeclared[], declared[] }
 */
function check(repoRoot, implementationMdPath) {
  const declared = extractDeclaredFiles(implementationMdPath);
  if (!declared) {
    return { ok: true, skipped: true, reason: 'No implementation.md found' };
  }
  if (declared.size === 0) {
    return { ok: true, skipped: true, reason: 'No file paths found in implementation.md' };
  }

  const changed = getChangedFiles(repoRoot);
  const undeclared = changed.filter(f => {
    const isTestOrConfig = f.startsWith('test/') || f.endsWith('.test.js') ||
      f.endsWith('.test.ts') || f === 'package.json' || f === 'package-lock.json';
    if (isTestOrConfig) return false;
    return !declared.has(f);
  });

  return {
    ok: undeclared.length === 0,
    undeclared,
    declared: [...declared],
    changed,
  };
}

if (require.main === module) {
  const repoRoot = process.argv[2] || process.cwd();
  const implPath = process.argv[3] || (() => {
    const worklogs = path.join(repoRoot, '.worklogs');
    if (!fs.existsSync(worklogs)) return null;
    const dirs = fs.readdirSync(worklogs).sort();
    if (dirs.length === 0) return null;
    return path.join(worklogs, dirs[dirs.length - 1], 'implementation.md');
  })();

  if (!implPath) {
    console.log('No work directory found. Skipping scope check.');
    process.exit(0);
  }

  const result = check(repoRoot, implPath);
  if (result.skipped) {
    console.log(`Scope check skipped: ${result.reason}`);
    process.exit(0);
  }
  if (result.ok) {
    console.log(`Scope check passed: ${result.changed.length} changed files, all declared.`);
    process.exit(0);
  }

  console.error(`Scope check FAILED: ${result.undeclared.length} undeclared file(s) modified:`);
  for (const f of result.undeclared) {
    console.error(`  - ${f}`);
  }
  console.error('\nDeclared files in implementation.md:');
  for (const f of result.declared) {
    console.error(`  + ${f}`);
  }
  console.error('\nTo fix: add these files to implementation.md or provide justification.');
  process.exit(1);
}

module.exports = { extractDeclaredFiles, getChangedFiles, check };
