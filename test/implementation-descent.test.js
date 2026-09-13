'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyTransition } = require('../scripts/lib/work-engine/engine.cjs');
const { buildFingerprint } = require('../scripts/lib/descent/fingerprint.cjs');
const { promoteOrDemote } = require('../scripts/lib/descent/promotion.cjs');
const { tryDescentLadder } = require('../scripts/lib/descent/ladder.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('implementation-entry descent', () => {
  it('sets skip_llm_exploration on fingerprint L0 hit, not on verify-only npm test', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-impl-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'hit.js'), 'module.exports = 1;\n');
    const verify = 'node -e "process.exit(0)"';
    const fp = buildFingerprint({ files: ['src/hit.js'], verifyCommand: verify });
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: fp,
      procedure: {
        actions: [{ type: 'READ_FILE', path: 'src/hit.js' }],
        verify: [{ type: 'RUN', command: verify }],
      },
      evalPassed: true,
      humanApproved: true,
    });

    const workDir = path.join(tmp, '.worklogs', 'w-pre');
    fs.mkdirSync(workDir, { recursive: true });
    const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
    const now = new Date().toISOString();
    tpl.work_id = 'w-pre';
    tpl.task = 'pre-impl descent';
    tpl.current_state = 'test-strategy';
    tpl.pipeline.track = 'standard';
    tpl.created_at = now;
    tpl.updated_at = now;
    tpl.timeout_at = now;
    tpl.metrics.verify_command = verify;
    tpl.budget.budget_remaining = 20;
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(tpl, null, 2));
    fs.writeFileSync(path.join(workDir, 'test-stubs.md'), '# stubs\n');
    fs.writeFileSync(
      path.join(workDir, 'design.md'),
      '# Design\n\n- `src/hit.js`\n\n```bash\nnode -e "process.exit(0)"\n```\n'
    );

    const r = applyTransition({
      workDir,
      pluginRoot,
      from: 'test-strategy',
      to: 'implementation',
      actor: 'test',
    });
    assert.equal(r.ok, true, r.message);
    assert.equal(r.state.current_state, 'implementation');
    assert.equal(r.state.metrics.skip_llm_exploration, true);
    assert.equal(r.state.metrics.descent_source, 'implementation-entry');
    assert.ok(r.state.metrics.descent_tier === 'L0' || r.state.metrics.descent_tier === 'L1');
    const packPath = path.join(workDir, 'context-pack.json');
    assert.ok(fs.existsSync(packPath));
    const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
    assert.ok(Array.isArray(pack.muscle_memory));
    assert.ok(pack.muscle_memory.some((m) => m.tier === 'L0'));
    assert.match(pack.constraints.join(' '), /skip_llm_exploration/);
    assert.ok(fs.existsSync(path.join(workDir, 'descent-replay.md')));
    assert.match(fs.readFileSync(path.join(workDir, 'descent-replay.md'), 'utf8'), /PASS/);

    const miss = await tryDescentLadder({
      projectRoot: tmp,
      pluginRoot,
      verifyCommand: 'npm test',
      files: ['unrelated.js'],
      strictFingerprint: true,
      skipL2: true,
    });
    assert.equal(miss.ok, false);
    assert.equal(miss.tier, 'L3');

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
