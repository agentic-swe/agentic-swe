'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { muscleMemoryDigestMarkdown, listMuscleMemoryRows } = require('../scripts/lib/descent/muscle-memory-digest.cjs');
const { promoteOrDemote } = require('../scripts/lib/descent/promotion.cjs');
const { buildFingerprint } = require('../scripts/lib/descent/fingerprint.cjs');
const { buildPrimeMarkdown } = require('../scripts/lib/memory/memory-prime.cjs');
const { runMemoryIndex } = require('../scripts/lib/memory/memory-pipeline.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('muscle memory digest', () => {
  it('omits unevaluated procedures and appears in memory prime', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-digest-'));
    const fp = buildFingerprint({ files: ['x.js'], verifyCommand: 'node -e "process.exit(0)"' });
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: fp,
      procedure: { verify: [{ type: 'RUN', command: 'node -e "process.exit(0)"' }] },
      evalPassed: true,
      humanApproved: true,
    });
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: 'uneval-fp',
      procedure: { verify: [{ type: 'RUN', command: 'npm test' }], _meta: { source: 'session-mine' } },
      evalPassed: false,
    });
    const rows = listMuscleMemoryRows(tmp);
    assert.ok(rows.some((r) => r.tier === 'L0'));
    assert.equal(
      rows.some((r) => r.command === 'npm test'),
      false
    );
    const md = muscleMemoryDigestMarkdown(tmp);
    assert.match(md, /Muscle memory/);
    await runMemoryIndex({ projectRoot: tmp, pluginRoot, skipGraph: true });
    const prime = await buildPrimeMarkdown({ projectRoot: tmp, pluginRoot, query: 'verify' });
    assert.match(prime, /Muscle memory/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
