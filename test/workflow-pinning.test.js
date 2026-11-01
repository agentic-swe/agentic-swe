'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const dir = path.join(__dirname, '..', '.github', 'workflows');

test('every workflow action is pinned to a commit SHA with a version comment', () => {
  const offenders = [];
  let count = 0;
  for (const file of fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = line.match(/^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/);
      if (!m) return;
      count += 1;
      if (m[1].startsWith('./')) return;
      if (!/@[0-9a-f]{40}$/.test(m[1]) || !/#\s*v\d+(\.\d+)*/.test(m[2])) offenders.push(`${file}:${i + 1} ${line.trim()}`);
    });
  }
  assert.ok(count > 0, 'no uses: lines found');
  assert.deepEqual(offenders, []);
});
