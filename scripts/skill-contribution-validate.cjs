#!/usr/bin/env node
/**
 * AE-028a: validate skill contribution packages (manifest + digest + optional contract tests).
 * Used by npm run verify (--self-check) and by contributors locally.
 *
 * Usage:
 *   node scripts/skill-contribution-validate.cjs --self-check
 *   node scripts/skill-contribution-validate.cjs path/to/skill-dir [more...]
 *   node scripts/skill-contribution-validate.cjs --json path/to/skill-dir
 */
'use strict';

const path = require('node:path');
const {
  validateSkillContribution,
  formatContributionResult,
  runContributionSelfCheck,
} = require('./lib/skills/skill-contribution-validate.cjs');

function resolveRoot() {
  const idx = process.argv.indexOf('--plugin-root');
  if (idx !== -1 && process.argv[idx + 1]) return path.resolve(process.argv[idx + 1]);
  return path.join(__dirname, '..');
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const selfCheck = argv.includes('--self-check');
  const skip = new Set();
  const rootFlag = argv.indexOf('--plugin-root');
  if (rootFlag !== -1) {
    skip.add(rootFlag);
    skip.add(rootFlag + 1);
  }
  for (const flag of ['--json', '--self-check']) {
    const i = argv.indexOf(flag);
    if (i !== -1) skip.add(i);
  }
  const paths = argv.filter((_, i) => !skip.has(i)).filter((a) => !a.startsWith('-'));

  const root = resolveRoot();

  if (selfCheck) {
    const out = runContributionSelfCheck(root);
    if (json) {
      console.log(JSON.stringify({ ok: out.ok, results: out.results }, null, 2));
    } else {
      console.log(out.summary);
    }
    process.exit(out.ok ? 0 : 1);
  }

  if (!paths.length) {
    console.error(
      'usage: node scripts/skill-contribution-validate.cjs --self-check | <skill-dir>...'
    );
    process.exit(2);
  }

  let failed = 0;
  const results = [];
  for (const p of paths) {
    const r = validateSkillContribution(path.resolve(p));
    results.push(r);
    if (!json) console.log(formatContributionResult(r));
    if (!r.ok) failed += 1;
  }
  if (json) console.log(JSON.stringify({ ok: failed === 0, results }, null, 2));
  process.exit(failed === 0 ? 0 : 1);
}

main();
