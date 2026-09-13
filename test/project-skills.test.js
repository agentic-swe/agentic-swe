'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promoteOrDemote } = require('../scripts/lib/descent/promotion.cjs');
const { buildFingerprint } = require('../scripts/lib/descent/fingerprint.cjs');
const {
  listSkills,
  scaffoldProjectSkillFromRitual,
  scaffoldMissingRitualSkills,
} = require('../scripts/lib/skills/project-skills.cjs');
const { suggestSkillEvalFromProcedures } = require('../scripts/lib/skills/skill-eval-suggestions.cjs');
const { routeSkillsWithMemory } = require('../scripts/lib/skills/skill-router.cjs');
const { checkSkillEvalGate } = require('../scripts/lib/skills/eval-gate.cjs');
const { collectFleetEvidence } = require('../scripts/fleet-evidence-bundle.cjs');
const { runEvolveCycle } = require('../scripts/evolve-cycle.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('project-local skills', () => {
  it('merges pack skills with project .agentic-swe/skills (project overrides)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-skill-'));
    const packCount = listSkills(pluginRoot).length;
    scaffoldProjectSkillFromRitual({
      projectRoot: tmp,
      skillName: 'team-lint',
      verifyCommand: 'npm run team-lint',
      source: 'repo-ritual',
    });
    const merged = listSkills(pluginRoot, tmp);
    assert.ok(merged.length >= packCount + 1);
    const local = merged.find((s) => s.name === 'team-lint');
    assert.ok(local);
    assert.equal(local.origin, 'project');
    assert.equal(local.eval_status, 'unevaluated');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('suggests create_skill for unknown evaluated npm run rituals', () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'unk-rit-'));
    promoteOrDemote({
      projectRoot: tmpProj,
      fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: 'npm run team-verify' }),
      procedure: {
        actions: [],
        verify: [{ type: 'RUN', command: 'npm run team-verify' }],
        _meta: { source: 'organic-worklog' },
      },
      evalPassed: true,
      humanApproved: true,
    });
    const r = suggestSkillEvalFromProcedures({ projectRoot: tmpProj, pluginRoot });
    assert.ok(r.scaffold_candidates.includes('team-verify'));
    const row = r.suggestions.find((s) => s.skill === 'team-verify');
    assert.equal(row.action, 'create_skill');
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });

  it('scaffolds missing ritual skills and routes them as unevaluated', async () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'scaf-rit-'));
    promoteOrDemote({
      projectRoot: tmpProj,
      fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: 'npm run team-verify' }),
      procedure: {
        actions: [],
        verify: [{ type: 'RUN', command: 'npm run team-verify' }],
        _meta: { source: 'repo-ritual' },
      },
      evalPassed: true,
      humanApproved: true,
    });
    const created = scaffoldMissingRitualSkills({ projectRoot: tmpProj, pluginRoot });
    assert.equal(created.created, 1);
    const gate = checkSkillEvalGate({
      pluginRoot,
      projectRoot: tmpProj,
      skillName: 'team-verify',
      autonomous: true,
    });
    assert.equal(gate.allowed, false);
    const routed = await routeSkillsWithMemory({
      pluginRoot,
      projectRoot: tmpProj,
      query: 'run team verify package',
      k: 8,
    });
    assert.ok(routed.results.some((row) => row.name === 'team-verify'));
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });
});

describe('evolve-cycle scaffold rituals', () => {
  it('scaffolds project skills when --scaffold-rituals is set', async () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-scaf-'));
    const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-scaf-p-'));
    promoteOrDemote({
      projectRoot: tmpProj,
      fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: 'npm run team-verify' }),
      procedure: {
        actions: [],
        verify: [{ type: 'RUN', command: 'npm run team-verify' }],
        _meta: { source: 'repo-ritual' },
      },
      evalPassed: true,
      humanApproved: true,
    });
    const mine = await runEvolveCycle({ projectRoot: tmpProj, pluginRoot: tmpPlugin, scaffoldRituals: true });
    assert.equal(mine.ok, true);
    assert.equal(mine.ritual_skill_scaffold?.created, 1);
    assert.ok(fs.existsSync(path.join(tmpProj, '.agentic-swe', 'skills', 'team-verify', 'SKILL.md')));
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });
});

describe('project skill memory ingest', () => {
  it('indexes project skills into team memory graph', async () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'ing-sk-'));
    scaffoldProjectSkillFromRitual({
      projectRoot: tmpProj,
      skillName: 'team-lint',
      verifyCommand: 'npm run team-lint',
    });
    const { ingestProjectSkills } = require('../scripts/lib/memory/ingest-scopes.cjs');
    const ing = await ingestProjectSkills({ projectRoot: tmpProj, pluginRoot });
    assert.equal(ing.skills, 1);
    assert.equal(ing.chunks, 1);
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });
});

describe('project skill promote', () => {
  it('promotes project-local skills when golden eval map is in .agentic-swe', () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'prom-proj-'));
    scaffoldProjectSkillFromRitual({
      projectRoot: tmpProj,
      skillName: 'team-verify',
      verifyCommand: 'npm run team-verify',
    });
    promoteOrDemote({
      projectRoot: tmpProj,
      fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: 'npm run team-verify' }),
      procedure: {
        actions: [],
        verify: [{ type: 'RUN', command: 'npm run team-verify' }],
        _meta: { source: 'repo-ritual' },
      },
      evalPassed: true,
      humanApproved: true,
    });
    fs.mkdirSync(path.join(tmpProj, '.agentic-swe'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpProj, '.agentic-swe', 'skill-golden-eval.json'),
      JSON.stringify({ version: 1, skills: { 'team-verify': 'bench/corpus/oracle-verify-sanity' } }, null, 2)
    );
    const { promoteRitualSkillCandidates } = require('../scripts/lib/skills/skill-eval-suggestions.cjs');
    const r = promoteRitualSkillCandidates({ projectRoot: tmpProj, pluginRoot });
    assert.equal(r.promoted, 1);
    const raw = fs.readFileSync(path.join(tmpProj, '.agentic-swe', 'skills', 'team-verify', 'SKILL.md'), 'utf8');
    assert.match(raw, /eval_status: "evaluated"/);
    const gate = checkSkillEvalGate({
      pluginRoot,
      projectRoot: tmpProj,
      skillName: 'team-verify',
      autonomous: true,
    });
    assert.equal(gate.allowed, true);
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });

  it('writes golden eval suggestions for isolated test rituals', () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'sug-gold-'));
    const { writeGoldenEvalSuggestions } = require('../scripts/lib/skills/project-skills.cjs');
    const out = writeGoldenEvalSuggestions(tmpProj, [
      {
        skill: 'team-verify',
        created: true,
        verify_command: 'node --test test/widget.test.js',
      },
    ]);
    assert.ok(out);
    const data = JSON.parse(
      fs.readFileSync(path.join(tmpProj, '.agentic-swe', 'skill-golden-eval.suggestions.json'), 'utf8')
    );
    assert.ok(data.skills['team-verify'].pack_eval_ref);
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });
});

describe('skill evolution pipeline', () => {
  it('scaffolds, promotes, and clears promote candidates when golden eval exists', async () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-prj-'));
    promoteOrDemote({
      projectRoot: tmpProj,
      fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: 'npm run team-verify' }),
      procedure: {
        actions: [],
        verify: [{ type: 'RUN', command: 'npm run team-verify' }],
        _meta: { source: 'repo-ritual' },
      },
      evalPassed: true,
      humanApproved: true,
    });
    fs.mkdirSync(path.join(tmpProj, '.agentic-swe'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpProj, '.agentic-swe', 'skill-golden-eval.json'),
      JSON.stringify({ version: 1, skills: { 'team-verify': 'bench/corpus/oracle-verify-sanity' } }, null, 2)
    );
    const { runSkillEvolutionPipeline } = require('../scripts/lib/skills/skill-eval-suggestions.cjs');
    const pipe = await runSkillEvolutionPipeline({ projectRoot: tmpProj, pluginRoot });
    assert.equal(pipe.scaffold?.created, 1);
    assert.equal(pipe.promote?.promoted, 1);
    assert.equal(pipe.after.promote_candidates.length, 0);
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });
});

describe('fleet evidence bundle', () => {
  it('packages honest fleet signals with goal_complete false', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-bun-'));
    const bundle = collectFleetEvidence({ projectRoot: tmp, pluginRoot });
    assert.equal(bundle.goal_complete, false);
    assert.equal(bundle.consumer_mode, true);
    assert.ok(bundle.muscle_memory);
    assert.ok(bundle.skill_eval);
    assert.ok(Array.isArray(bundle.submission_checklist));
    assert.equal(bundle.submission_readiness.fleet_submission_ready, false);
    assert.ok(bundle.submission_readiness.blockers.length >= 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
