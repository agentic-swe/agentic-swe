'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeContextPack, validateContextPack } = require('../scripts/lib/context/write-context-pack.cjs');
const { promoteOrDemote } = require('../scripts/lib/descent/promotion.cjs');
const { buildFingerprint } = require('../scripts/lib/descent/fingerprint.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('write-context-pack', () => {
  it('writes schema-valid JSON with muscle_memory from evaluated procedures', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-pack-'));
    const fp = buildFingerprint({ files: ['src/a.js'], verifyCommand: 'node -e "process.exit(0)"' });
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: fp,
      procedure: { verify: [{ type: 'RUN', command: 'node -e "process.exit(0)"' }] },
      evalPassed: true,
      humanApproved: true,
    });
    const workDir = path.join(tmp, '.worklogs', 'w1');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({ work_id: 'w1', current_state: 'implementation', metrics: {} })
    );
    fs.writeFileSync(path.join(workDir, 'design.md'), '# D\n\n- `src/a.js`\n');
    const r = writeContextPack({ workDir, projectRoot: tmp, pluginRoot });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    const v = validateContextPack(r.pack, pluginRoot);
    assert.equal(v.ok, true, JSON.stringify(v.errors));
    assert.ok(r.pack.muscle_memory.length >= 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
