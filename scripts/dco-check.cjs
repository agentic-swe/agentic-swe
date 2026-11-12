#!/usr/bin/env node
/**
 * AE-028b: DCO 1.1 check for a git commit range.
 *
 * Usage:
 *   node scripts/dco-check.cjs <base>..<head>
 *   node scripts/dco-check.cjs --json <base>..<head>
 *
 * Inspects only commits reachable from head that are not on base
 * (`git rev-list --no-merges` is NOT used — merges are skipped in the
 * pure checker so merge commits with multiple parents never fail DCO).
 * Range must not be blank. Fail closed on git errors.
 */
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { minimalChildEnv } = require('./lib/shared/child-env.cjs');
const {
  checkCommitsDco,
  formatDcoResult,
} = require('./lib/skills/dco-check.cjs');

const RECORD_SEP = '\x1e';
const FIELD_SEP = '\x1f';

function resolveRoot() {
  const idx = process.argv.indexOf('--plugin-root');
  if (idx !== -1 && process.argv[idx + 1]) return path.resolve(process.argv[idx + 1]);
  return path.join(__dirname, '..');
}

/**
 * Parse `base..head` or `base...head`. Reject blank / incomplete ranges.
 * @param {string} raw
 * @returns {{ ok: true, base: string, head: string } | { ok: false, code: string, message: string }}
 */
function parseRange(raw) {
  const s = String(raw || '').trim();
  if (!s) {
    return { ok: false, code: 'RANGE_BLANK', message: 'commit range is blank' };
  }
  const m = s.match(/^([^.]+)\.{2,3}([^.]+)$/);
  if (!m) {
    return {
      ok: false,
      code: 'RANGE_INVALID',
      message: `commit range must be base..head (got ${JSON.stringify(s)})`,
    };
  }
  const base = m[1].trim();
  const head = m[2].trim();
  if (!base || !head) {
    return { ok: false, code: 'RANGE_BLANK', message: 'base or head is blank' };
  }
  return { ok: true, base, head };
}

/**
 * Load commits in `base..head` via git log (argv only, minimalChildEnv).
 * Format per commit: hash, parentCount, authorEmail, subject, body.
 * @param {string} cwd
 * @param {string} base
 * @param {string} head
 * @returns {{ ok: true, commits: object[] } | { ok: false, code: string, message: string }}
 */
function loadCommitsForRange(cwd, base, head) {
  // %P parent hashes (space-separated) → parent count; body may contain newlines so use RS.
  const pretty = [
    '%H',
    '%P',
    '%ae',
    '%s',
    '%b',
  ].join(FIELD_SEP);
  const r = spawnSync(
    'git',
    [
      '-C',
      cwd,
      'log',
      '--reverse',
      `--pretty=format:${pretty}${RECORD_SEP}`,
      `${base}..${head}`,
    ],
    {
      encoding: 'utf8',
      shell: false,
      env: minimalChildEnv(),
    }
  );
  if (r.error) {
    return { ok: false, code: 'GIT_SPAWN_FAILED', message: r.error.message };
  }
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || 'git log failed').trim().slice(0, 500);
    return { ok: false, code: 'GIT_LOG_FAILED', message: err };
  }

  const blob = String(r.stdout || '');
  const commits = [];
  for (const record of blob.split(RECORD_SEP)) {
    const raw = record.replace(/^\n+/, '').replace(/\n+$/, '');
    if (!raw.trim()) continue;
    const parts = raw.split(FIELD_SEP);
    if (parts.length < 4) {
      return {
        ok: false,
        code: 'GIT_LOG_PARSE',
        message: `unexpected git log record fields (${parts.length})`,
      };
    }
    const [hash, parentsRaw, authorEmail, subject, ...bodyParts] = parts;
    const body = bodyParts.join(FIELD_SEP);
    const parentHashes = String(parentsRaw || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    commits.push({
      hash: String(hash || '').trim(),
      parents: parentHashes,
      parentCount: parentHashes.length,
      authorEmail: String(authorEmail || '').trim(),
      subject: String(subject || ''),
      body: String(body || ''),
      message: `${subject || ''}\n\n${body || ''}`.trimEnd(),
    });
  }
  return { ok: true, commits };
}

function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes('--json');
  const skip = new Set();
  if (json) skip.add(argv.indexOf('--json'));
  const rootFlag = argv.indexOf('--plugin-root');
  if (rootFlag !== -1) {
    skip.add(rootFlag);
    skip.add(rootFlag + 1);
  }
  const positional = argv.filter((_, i) => !skip.has(i)).filter((a) => !a.startsWith('-'));
  const rangeRaw = positional[0];

  if (!rangeRaw) {
    console.error('usage: node scripts/dco-check.cjs [--json] <base>..<head>');
    process.exit(2);
  }

  const parsed = parseRange(rangeRaw);
  if (!parsed.ok) {
    console.error(`dco-check: FAIL code=${parsed.code} ${parsed.message}`);
    process.exit(1);
  }

  const root = resolveRoot();
  const loaded = loadCommitsForRange(root, parsed.base, parsed.head);
  if (!loaded.ok) {
    console.error(`dco-check: FAIL code=${loaded.code} ${loaded.message}`);
    process.exit(1);
  }

  const outcome = checkCommitsDco(loaded.commits);
  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: outcome.ok,
          range: `${parsed.base}..${parsed.head}`,
          checked: outcome.checked,
          skipped: outcome.skipped,
          failures: outcome.failures,
        },
        null,
        2
      )
    );
  } else {
    console.log(formatDcoResult(outcome));
    console.log(`  range: ${parsed.base}..${parsed.head}`);
  }
  process.exit(outcome.ok ? 0 : 1);
}

main();
