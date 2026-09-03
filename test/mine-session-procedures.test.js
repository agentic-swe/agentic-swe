'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractExistingRepoPaths } = require('../scripts/lib/descent/mine-session-procedures.cjs');

describe('mine-session path extraction', () => {
  it('returns existing repo-relative paths from a chunk', () => {
    const tmp = path.join(__dirname, '_tmp-mine-session');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmp, 'scripts', 'lib'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'scripts', 'lib', 'foo.cjs'), '1\n');
    const body = 'Ran `npm test` after editing `scripts/lib/foo.cjs` and missing `src/nope.js`.';
    const files = extractExistingRepoPaths(body, tmp);
    assert.deepEqual(files, ['scripts/lib/foo.cjs']);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
