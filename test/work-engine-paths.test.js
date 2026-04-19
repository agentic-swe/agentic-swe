'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { resolveEvidenceRef } = require('../scripts/lib/work-engine/paths.cjs');

const workDir = path.resolve('/tmp/agentic-swe-work-engine-test');

describe('work-engine evidence paths', () => {
  it('resolves relative refs under workDir', () => {
    const r = resolveEvidenceRef(workDir, 'feasibility.md');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.resolved, path.join(workDir, 'feasibility.md'));
  });

  it('rejects ..', () => {
    const r = resolveEvidenceRef(workDir, '../etc/passwd');
    assert.strictEqual(r.ok, false);
  });
});
