'use strict';

/**
 * CODEOWNERS parsing and matching with GitHub semantics: gitignore-style patterns, the last
 * matching rule wins, and a rule with no owners leaves the path unowned.
 */

const { minimatch } = require('minimatch');

function parseCodeowners(text) {
  const rules = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    rules.push({ pattern, owners: owners.filter((o) => o.startsWith('@') || o.includes('@')) });
  }
  return rules;
}

function toGlobs(pattern) {
  let p = pattern;
  const anchored = p.startsWith('/') || p.slice(0, -1).includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  if (p.endsWith('/')) p = `${p}**`;
  if (!anchored) p = `**/${p}`;
  const last = p.split('/').pop();
  return last.includes('*') ? [p] : [p, `${p}/**`];
}

function matches(file, pattern) {
  if (pattern === '*') return true;
  return toGlobs(pattern).some((g) => minimatch(file, g, { dot: true }));
}

/** Owners for one repo-relative path, or [] when unowned. */
function ownersFor(rules, file) {
  let owners = [];
  for (const rule of rules) {
    if (matches(file, rule.pattern)) owners = rule.owners;
  }
  return owners;
}

module.exports = { parseCodeowners, ownersFor, matches };
