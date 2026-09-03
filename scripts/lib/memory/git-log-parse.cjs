'use strict';

/**
 * Parse `git log --pretty=format:%H%x09%an%x09%s --name-only` (no diffs).
 * @param {string} raw
 * @param {number} maxCommits
 */
function parseGitLogNameOnly(raw, maxCommits) {
  const commits = [];
  let current = null;
  for (const line of String(raw || '').split(/\r?\n/)) {
    if (/^[0-9a-f]{40}\t/i.test(line)) {
      if (current) {
        commits.push(current);
        if (commits.length >= maxCommits) return commits;
      }
      const [hash, author, ...rest] = line.split('\t');
      current = { hash, author, subject: rest.join('\t'), files: [] };
      continue;
    }
    if (current && line) current.files.push(line);
  }
  if (current && commits.length < maxCommits) commits.push(current);
  return commits;
}

module.exports = { parseGitLogNameOnly };
