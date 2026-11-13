'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  candidatesFromTranscript,
  packageDiscoveredCandidates,
} = require('../scripts/lib/skills/skill-candidates.cjs');
const {
  writeCandidatePackage,
  writeCandidatePackages,
  listPackagedCandidates,
  isCandidateAutonomousAllowed,
  candidatesRoot,
} = require('../scripts/lib/skills/candidate-package.cjs');
const { validateSkillContribution } = require('../scripts/lib/skills/skill-contribution-validate.cjs');
const { routeSkills } = require('../scripts/lib/skills/skill-router.cjs');

const pluginRoot = path.resolve(__dirname, '..');
const FIXTURE_TRANSCRIPT = path.join(
  pluginRoot,
  'test/fixtures/skill-candidates/transcript-tools.jsonl'
);

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ae-032b-'));
}

describe('AE-032b deterministic candidate packages', () => {
  it('writes manifest.json + CONTRACT.md + contract.test.js under .agentic-swe/skills/candidates/', () => {
    const projectRoot = tmpProject();
    const candidate = {
      candidate_id: 'cand-check-fixture',
      skill: 'check',
      kind: 'npm_run',
      status: 'candidate',
      eval_status: 'unevaluated',
      verify_command: 'npm run check',
      quarantined: false,
      source_evidence: [{ kind: 'transcript', verify_command: 'npm run check' }],
      autonomous_selection: false,
    };
    const r = writeCandidatePackage({ projectRoot, candidate, validate: true, runTests: true });
    assert.equal(r.ok, true, JSON.stringify(r.errors || r.validation));
    assert.equal(r.status, 'candidate');
    assert.equal(r.eval_status, 'unevaluated');
    assert.equal(r.autonomous_selection, false);

    const dest = path.join(candidatesRoot(projectRoot), 'check');
    assert.equal(r.path, dest);
    for (const f of ['SKILL.md', 'manifest.json', 'CONTRACT.md', 'contract.test.js', 'candidate-meta.json']) {
      assert.ok(fs.existsSync(path.join(dest, f)), f);
    }
    const meta = JSON.parse(fs.readFileSync(path.join(dest, 'candidate-meta.json'), 'utf8'));
    assert.equal(meta.status, 'candidate');
    assert.equal(meta.eval_status, 'unevaluated');
    assert.equal(meta.autonomous_selection, false);
    assert.equal(meta.generator_mode, 'templates-only');
    assert.match(fs.readFileSync(path.join(dest, 'CONTRACT.md'), 'utf8'), /## Inputs/);
    assert.match(fs.readFileSync(path.join(dest, 'CONTRACT.md'), 'utf8'), /## Permissions/);
  });

  it('generated fixture package passes skill-contribution-validate', () => {
    const projectRoot = tmpProject();
    const fromTx = candidatesFromTranscript({
      projectRoot,
      transcriptPath: FIXTURE_TRANSCRIPT,
    });
    assert.ok(fromTx.ok);
    assert.ok(fromTx.candidates.length >= 1);

    const packaged = writeCandidatePackages({
      projectRoot,
      candidates: fromTx.candidates,
      validate: true,
      runTests: true,
    });
    assert.equal(packaged.ok, true, JSON.stringify(packaged.errors));
    assert.ok(packaged.count >= 1);

    for (const w of packaged.written) {
      const v = validateSkillContribution(w.path, { runTests: true });
      assert.equal(v.ok, true, `${w.skill}: ${JSON.stringify(v.errors)}`);
    }
  });

  it('status is candidate/unevaluated and autonomous_selection stays false', () => {
    const projectRoot = tmpProject();
    const r = writeCandidatePackage({
      projectRoot,
      candidate: {
        skill: 'lint',
        kind: 'npm_run',
        verify_command: 'npm run lint',
        autonomous_selection: false,
      },
    });
    assert.equal(r.ok, true);
    const listed = listPackagedCandidates(projectRoot);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].status, 'candidate');
    assert.equal(listed[0].eval_status, 'unevaluated');
    assert.equal(listed[0].autonomous_selection, false);

    const gate = isCandidateAutonomousAllowed({ projectRoot, skillName: 'lint' });
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, 'CANDIDATE_UNEVALUATED');
  });

  it('refuses packaging when autonomous_selection is true', () => {
    const projectRoot = tmpProject();
    const r = writeCandidatePackage({
      projectRoot,
      candidate: {
        skill: 'bad',
        verify_command: 'npm run bad',
        autonomous_selection: true,
      },
      validate: false,
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'AUTONOMOUS_FORBIDDEN');
  });

  it('packageDiscoveredCandidates end-to-end from transcript fixture', () => {
    const projectRoot = tmpProject();
    const r = packageDiscoveredCandidates({
      projectRoot,
      transcriptPath: FIXTURE_TRANSCRIPT,
      validate: true,
      runTests: true,
    });
    assert.equal(r.ok, true, JSON.stringify(r.packaged && r.packaged.errors));
    assert.ok(r.packaged.count >= 1);
    assert.ok(fs.existsSync(candidatesRoot(projectRoot)));
  });

  it('autonomous skill selection never treats packaged candidates as allowed', () => {
    const projectRoot = tmpProject();
    const skill = 'ae032b-cand-ritual';
    writeCandidatePackage({
      projectRoot,
      candidate: {
        skill,
        kind: 'npm_run',
        verify_command: 'npm run ae032b-cand-ritual',
        autonomous_selection: false,
      },
    });
    const gate = isCandidateAutonomousAllowed({ projectRoot, skillName: skill });
    assert.equal(gate.allowed, false);

    // Router autonomous path only returns evaluated pack skills — candidates live outside catalog.
    const sel = routeSkills({
      pluginRoot,
      projectRoot,
      query: 'ae032b-cand-ritual verify',
      autonomous: true,
      k: 20,
    });
    assert.ok(Array.isArray(sel.results));
    assert.equal(
      (sel.results || []).some((row) => (row.name || row.skill) === skill),
      false,
      'packaged candidate must not appear in autonomous route results'
    );
    for (const row of sel.results || []) {
      assert.equal(row.autonomous_allowed, true);
    }
  });

  it('uses templates only — no LLM marker / network in generator outputs', () => {
    const projectRoot = tmpProject();
    const r = writeCandidatePackage({
      projectRoot,
      candidate: {
        skill: 'test',
        kind: 'npm_run',
        verify_command: 'npm run test',
      },
    });
    assert.equal(r.ok, true);
    const skillMd = fs.readFileSync(path.join(r.path, 'SKILL.md'), 'utf8');
    assert.match(skillMd, /templates only/i);
    assert.doesNotMatch(skillMd, /\b(openai|anthropic|ollama)\b/i);
    assert.doesNotMatch(skillMd, /paid\s+LLM/i);
    const meta = JSON.parse(fs.readFileSync(path.join(r.path, 'candidate-meta.json'), 'utf8'));
    assert.equal(meta.generator_mode, 'templates-only');
  });
});
