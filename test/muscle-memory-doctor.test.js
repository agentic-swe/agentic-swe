'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promoteOrDemote } = require('../scripts/lib/descent/promotion.cjs');
const { buildFingerprint } = require('../scripts/lib/descent/fingerprint.cjs');
const { tryLadderThenOverlap } = require('../scripts/lib/descent/overlap-procedure.cjs');
const { runDescentOnImplementationEntry } = require('../scripts/lib/descent/implementation-descent.cjs');
const { checkMuscleMemoryReadiness } = require('../scripts/lib/work-engine/muscle-memory-doctor.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('overlap source on fingerprint hit', () => {
  it('reports procedure _meta.source when L0 hits by fingerprint', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-overlap-'));
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
        _meta: { source: 'organic-worklog' },
      },
      evalPassed: true,
      humanApproved: true,
    });

    const { hit, overlap } = await tryLadderThenOverlap({
      projectRoot: tmp,
      pluginRoot,
      verifyCommand: verify,
      files: ['src/hit.js'],
      strictFingerprint: true,
      skipL2: true,
    });
    assert.equal(hit, true);
    assert.equal(overlap?.procedure?._meta?.source, 'organic-worklog');

    const workDir = path.join(tmp, '.worklogs', 'w-fp');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({ work_id: 'w-fp', current_state: 'test-strategy', metrics: { verify_command: verify }, budget: {} })
    );
    fs.writeFileSync(
      path.join(workDir, 'design.md'),
      `# Design\n\n- \`src/hit.js\`\n\n\`\`\`bash\n${verify}\n\`\`\`\n`
    );
    const r = await runDescentOnImplementationEntry({ workDir, pluginRoot, projectRoot: tmp });
    assert.equal(r.skip_llm_exploration, true);
    assert.equal(r.overlap_source, 'organic-worklog');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('muscle memory doctor', () => {
  it('detects consumer mode and writable memory store', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-doc-'));
    const r = checkMuscleMemoryReadiness({ projectRoot: tmp, pluginRoot });
    assert.equal(r.consumer_mode, true);
    assert.equal(r.ok, true);
    assert.ok(r.checks.some((c) => c.id === 'memory_store_writable' && c.ok));
    assert.ok(r.skill_eval);
    assert.ok(Array.isArray(r.skill_eval.promote_candidates));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports evaluated procedure npm run ritual skills for skill routing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-rit-'));
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: 'npm run zeta-helper' }),
      procedure: {
        actions: [{ type: 'READ_FILE', path: 'package.json' }],
        verify: [{ type: 'RUN', command: 'npm run zeta-helper' }],
        _meta: { source: 'repo-ritual' },
      },
      evalPassed: true,
      humanApproved: true,
    });
    const r = checkMuscleMemoryReadiness({ projectRoot: tmp, pluginRoot });
    assert.ok(r.procedures.evaluated >= 1);
    assert.ok(r.procedures.ritual_skills.includes('zeta-helper'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('includes fleet evidence blockers for consumer repos', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-fleet-'));
    const r = checkMuscleMemoryReadiness({ projectRoot: tmp, pluginRoot });
    assert.ok(r.fleet_evidence);
    assert.equal(r.fleet_evidence.organic_live, 0);
    assert.equal(r.fleet_evidence.fleet_submission_ready, false);
    assert.ok(r.fleet_evidence.blockers.some((b) => b.includes('organic_live')));
    assert.match(r.fleet_evidence.next_command, /fleet-onboard/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
