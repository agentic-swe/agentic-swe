'use strict';

/**
 * AE-028b: Developer Certificate of Origin (DCO 1.1) commit checks.
 * Layer: skills (service). Pure functions on commit metadata — no network.
 *
 * A non-merge commit passes when it has a `Signed-off-by:` trailer whose
 * email matches the commit author email (case-insensitive).
 */

const SIGNED_OFF_RE = /^Signed-off-by:\s*(.+?)\s*<([^>]+)>\s*$/im;
const SIGNED_OFF_LINE_RE = /^Signed-off-by:\s*.+?<([^>]+)>\s*$/gim;

/**
 * Extract Signed-off-by emails from a commit message body/subject blob.
 * @param {string} message
 * @returns {string[]} lowercase emails
 */
function extractSignedOffEmails(message) {
  const text = String(message || '');
  const emails = [];
  SIGNED_OFF_LINE_RE.lastIndex = 0;
  let m;
  while ((m = SIGNED_OFF_LINE_RE.exec(text)) !== null) {
    const email = String(m[1] || '').trim().toLowerCase();
    if (email) emails.push(email);
  }
  return emails;
}

/**
 * True when parents indicate a merge (two or more parents).
 * @param {{ parents?: string[]|string, parentCount?: number }} commit
 * @returns {boolean}
 */
function isMergeCommit(commit) {
  if (commit && typeof commit.parentCount === 'number') {
    return commit.parentCount >= 2;
  }
  const parents = commit && commit.parents;
  if (Array.isArray(parents)) return parents.length >= 2;
  if (typeof parents === 'string') {
    const parts = parents.trim().split(/\s+/).filter(Boolean);
    return parts.length >= 2;
  }
  return false;
}

/**
 * Check one commit's DCO trailer against its author email.
 * @param {{
 *   hash?: string,
 *   authorEmail?: string,
 *   subject?: string,
 *   body?: string,
 *   message?: string,
 *   parents?: string[]|string,
 *   parentCount?: number,
 * }} commit
 * @returns {{
 *   ok: boolean,
 *   skipped?: boolean,
 *   code?: string,
 *   hash?: string,
 *   authorEmail?: string,
 *   detail?: string,
 * }}
 */
function checkCommitDco(commit) {
  const hash = commit && commit.hash != null ? String(commit.hash) : undefined;
  if (isMergeCommit(commit)) {
    return { ok: true, skipped: true, hash, detail: 'merge commit skipped' };
  }

  const authorEmail = String((commit && commit.authorEmail) || '').trim();
  if (!authorEmail) {
    return {
      ok: false,
      code: 'AUTHOR_EMAIL_BLANK',
      hash,
      authorEmail: '',
      detail: 'author email is blank',
    };
  }

  const message =
    commit && commit.message != null
      ? String(commit.message)
      : [commit && commit.subject, commit && commit.body].filter(Boolean).join('\n\n');

  const signed = extractSignedOffEmails(message);
  if (signed.length === 0) {
    return {
      ok: false,
      code: 'DCO_MISSING',
      hash,
      authorEmail,
      detail: 'missing Signed-off-by trailer',
    };
  }

  const want = authorEmail.toLowerCase();
  if (!signed.includes(want)) {
    return {
      ok: false,
      code: 'DCO_EMAIL_MISMATCH',
      hash,
      authorEmail,
      detail: `Signed-off-by email(s) [${signed.join(', ')}] do not match author ${want}`,
    };
  }

  return { ok: true, hash, authorEmail, detail: 'Signed-off-by matches author' };
}

/**
 * Check a list of commits. Fail closed: any non-ok non-skipped failure fails the suite.
 * @param {Array<object>} commits
 * @param {{ requireNonEmpty?: boolean }} [opts]
 *   When `requireNonEmpty` is true (CI pull_request), checked===0 fails closed
 *   so an empty `base..head` range cannot vacuous-PASS. Pushes/local runs omit it.
 * @returns {{
 *   ok: boolean,
 *   checked: number,
 *   skipped: number,
 *   failures: Array<object>,
 *   results: Array<object>,
 * }}
 */
function checkCommitsDco(commits, opts = {}) {
  const list = Array.isArray(commits) ? commits : [];
  const results = [];
  const failures = [];
  let checked = 0;
  let skipped = 0;

  for (const commit of list) {
    const r = checkCommitDco(commit);
    results.push(r);
    if (r.skipped) {
      skipped += 1;
      continue;
    }
    checked += 1;
    if (!r.ok) failures.push(r);
  }

  if (opts.requireNonEmpty && checked === 0) {
    failures.push({
      ok: false,
      code: 'DCO_EMPTY_RANGE',
      detail:
        'pull_request DCO range checked 0 non-merge commits (vacuous PASS refused); expected at least one signed commit in base..head',
    });
  }

  return {
    ok: failures.length === 0,
    checked,
    skipped,
    failures,
    results,
  };
}

/**
 * Human-readable summary for CI logs.
 * @param {ReturnType<typeof checkCommitsDco>} outcome
 * @returns {string}
 */
function formatDcoResult(outcome) {
  const lines = [];
  const status = outcome.ok ? 'PASS' : 'FAIL';
  lines.push(
    `dco-check: ${status} (checked=${outcome.checked} skipped_merges=${outcome.skipped} failures=${outcome.failures.length})`
  );
  for (const f of outcome.failures || []) {
    const id = f.hash ? f.hash.slice(0, 12) : '(no-hash)';
    lines.push(`  FAIL ${id} code=${f.code || 'DCO_FAIL'} ${f.detail || ''}`);
  }
  if (outcome.ok) {
    lines.push('  All non-merge commits have Signed-off-by matching author email.');
  }
  return lines.join('\n');
}

module.exports = {
  SIGNED_OFF_RE,
  extractSignedOffEmails,
  isMergeCommit,
  checkCommitDco,
  checkCommitsDco,
  formatDcoResult,
};
