'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promoteOrDemote } = require('../scripts/lib/descent/promotion.cjs');
const { buildFingerprint } = require('../scripts/lib/descent/fingerprint.cjs');
const {
  parseNpmRunSkill,
  collectProcedureRitualSkills,
} = require('../scripts/lib/skills/procedure-ritual-skills.cjs');
const {
  suggestSkillEvalFromProcedures,
  promoteRitualSkillCandidates,
} = require('../scripts/lib/skills/skill-eval-suggestions.cjs');
const { runEvolveCycle } = require('../scripts/evolve-cycle.cjs');
const { spawnSync } = require('node:child_process');

const pluginRoot = path.resolve(__dirname, '..');

function patchSkillEvalStatus(skillPath, status) {
  let raw = fs.readFileSync(skillPath, 'utf8');
  raw = raw.replace(/eval_status: "(evaluated|unevaluated)"/, `eval_status: "${status}"`);
  fs.writeFileSync(skillPath, raw);
}

function makeTmpPluginWithCheckSkill(tmpPlugin) {
  fs.mkdirSync(path.join(tmpPlugin, 'skills', 'check'), { recursive: true });
  fs.mkdirSync(path.join(tmpPlugin, 'config'), { recursive: true });
  fs.copyFileSync(
    path.join(pluginRoot, 'skills', 'check', 'SKILL.md'),
    path.join(tmpPlugin, 'skills', 'check', 'SKILL.md')
  );
  patchSkillEvalStatus(path.join(tmpPlugin, 'skills', 'check', 'SKILL.md'), 'unevaluated');
  fs.copyFileSync(
    path.join(pluginRoot, 'config', 'skill-golden-eval.json'),
    path.join(tmpPlugin, 'config', 'skill-golden-eval.json')
  );
}

describe('procedure ritual skills', () => {
  it('parses npm run skill names from verify commands', () => {
    assert.equal(parseNpmRunSkill('npm run check'), 'check');
    assert.equal(parseNpmRunSkill('NODE_ENV=test npm run work-engine -- doctor'), 'work-engine');
    assert.equal(parseNpmRunSkill('npm test'), null);
  });

  it('aggregates evaluated and unevaluated procedure rituals', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rit-agg-'));
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: buildFingerprint({ files: ['a.js'], verifyCommand: 'npm run check' }),
      procedure: {
        actions: [],
        verify: [{ type: 'RUN', command: 'npm run check' }],
        _meta: { source: 'repo-ritual' },
      },
      evalPassed: true,
      humanApproved: true,
    });
    promoteOrDemote({
      projectRoot: tmp,
      fingerprint: buildFingerprint({ files: ['b.js'], verifyCommand: 'npm run check' }),
      procedure: {
        actions: [],
        verify: [{ type: 'RUN', command: 'npm run check' }],
        _meta: { source: 'session-mine' },
      },
      evalPassed: false,
      humanApproved: false,
    });
    const rituals = collectProcedureRitualSkills(tmp);
    const check = rituals.find((r) => r.skill === 'check');
    assert.ok(check);
    assert.equal(check.evaluated, 1);
    assert.equal(check.unevaluated, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('skill-eval suggestions', () => {
  it('suggests promote when evaluated procedure ritual matches unevaluated skill with golden eval', () => {
    const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'sug-plg-'));
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'sug-prj-'));
    makeTmpPluginWithCheckSkill(tmpPlugin);
    promoteOrDemote({
      projectRoot: tmpProj,
      fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: 'npm run check' }),
      procedure: {
        actions: [{ type: 'READ_FILE', path: 'package.json' }],
        verify: [{ type: 'RUN', command: 'npm run check' }],
        _meta: { source: 'organic-worklog' },
      },
      evalPassed: true,
      humanApproved: true,
    });
    const r = suggestSkillEvalFromProcedures({ projectRoot: tmpProj, pluginRoot: tmpPlugin });
    const row = r.suggestions.find((s) => s.skill === 'check');
    assert.ok(row);
    assert.equal(row.action, 'promote');
    assert.ok(r.promote_candidates.includes('check'));
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });

  it('dry-run promote-rituals reports candidates without patching skills', () => {
    const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'dry-plg-'));
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'dry-prj-'));
    makeTmpPluginWithCheckSkill(tmpPlugin);
    promoteOrDemote({
      projectRoot: tmpProj,
      fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: 'npm run check' }),
      procedure: {
        actions: [],
        verify: [{ type: 'RUN', command: 'npm run check' }],
        _meta: { source: 'repo-ritual' },
      },
      evalPassed: true,
      humanApproved: true,
    });
    const r = promoteRitualSkillCandidates({ projectRoot: tmpProj, pluginRoot: tmpPlugin, dryRun: true });
    assert.equal(r.total, 1);
    assert.equal(r.promoted, 1);
    assert.equal(r.results[0].dry_run, true);
    const raw = fs.readFileSync(path.join(tmpPlugin, 'skills', 'check', 'SKILL.md'), 'utf8');
    assert.match(raw, /eval_status: "unevaluated"/);
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });
});

describe('evolve-cycle skill suggestions', () => {
  it('includes skill_eval_suggestions after mining', async () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-sug-'));
    const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-sug-p-'));
    makeTmpPluginWithCheckSkill(tmpPlugin);
    promoteOrDemote({
      projectRoot: tmpProj,
      fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: 'npm run check' }),
      procedure: {
        actions: [],
        verify: [{ type: 'RUN', command: 'npm run check' }],
        _meta: { source: 'repo-ritual' },
      },
      evalPassed: true,
      humanApproved: true,
    });
    const mine = await runEvolveCycle({ projectRoot: tmpProj, pluginRoot: tmpPlugin, limit: 2 });
    assert.equal(mine.ok, true);
    assert.ok(Array.isArray(mine.skill_eval_suggestions));
    assert.ok(mine.skill_eval_promote_candidates.includes('check'));
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });
});

describe('session skill route hint promote section', () => {
  it('prints skill-eval promote candidates when procedure rituals match unevaluated skills', () => {
    const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'hint-plg-'));
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'hint-prj-'));
    makeTmpPluginWithCheckSkill(tmpPlugin);
    promoteOrDemote({
      projectRoot: tmpProj,
      fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: 'npm run check' }),
      procedure: {
        actions: [],
        verify: [{ type: 'RUN', command: 'npm run check' }],
        _meta: { source: 'repo-ritual' },
      },
      evalPassed: true,
      humanApproved: true,
    });
    const r = spawnSync(
      process.execPath,
      [
        path.join(pluginRoot, 'scripts/session-skill-route-hint.cjs'),
        '--project-root',
        tmpProj,
        '--plugin-root',
        tmpPlugin,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          AGENTIC_SWE_SKILL_ROUTE_HINT: '1',
          AGENTIC_SWE_SKILL_ROUTE_QUERY: 'verify package scripts',
        },
      }
    );
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Skill eval \(procedure rituals\)/);
    assert.match(r.stdout, /promote-rituals/);
    assert.match(r.stdout, /`check`/);
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });
});

describe('session-capture promote rituals env', () => {
  it('forwards AGENTIC_SWE_PROMOTE_RITUALS=dry-run to evolve-cycle', () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-prj-'));
    const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-plg-'));
    makeTmpPluginWithCheckSkill(tmpPlugin);
    promoteOrDemote({
      projectRoot: tmpProj,
      fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: 'npm run check' }),
      procedure: {
        actions: [],
        verify: [{ type: 'RUN', command: 'npm run check' }],
        _meta: { source: 'repo-ritual' },
      },
      evalPassed: true,
      humanApproved: true,
    });
    const transcript = path.join(tmpProj, 'session.jsonl');
    fs.writeFileSync(
      transcript,
      '{"type":"user","message":{"role":"user","content":"run npm run check"}}\n'
    );
    const r = spawnSync(
      process.execPath,
      [
        path.join(pluginRoot, 'scripts/session-capture.cjs'),
        '--project-root',
        tmpProj,
        '--plugin-root',
        tmpPlugin,
        '--transcript-path',
        transcript,
        '--json',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          AGENTIC_SWE_EVOLVE_ON_STOP: '1',
          AGENTIC_SWE_PROMOTE_RITUALS: 'dry-run',
        },
      }
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const payload = JSON.parse(r.stdout.trim());
    assert.equal(payload.ok, true);
    assert.ok(payload.evolve);
    assert.ok(payload.evolve.skill_eval_promote_candidates.includes('check'));
    assert.equal(payload.evolve.ritual_skill_promote?.results?.[0]?.dry_run, true);
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });
});

describe('session-capture evolve skills env', () => {
  it('forwards AGENTIC_SWE_EVOLVE_SKILLS=dry-run to scaffold and promote', () => {
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-sk-'));
    const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-sk-p-'));
    makeTmpPluginWithCheckSkill(tmpPlugin);
    promoteOrDemote({
      projectRoot: tmpProj,
      fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: 'npm run check' }),
      procedure: {
        actions: [],
        verify: [{ type: 'RUN', command: 'npm run check' }],
        _meta: { source: 'repo-ritual' },
      },
      evalPassed: true,
      humanApproved: true,
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
      JSON.stringify({ version: 1, skills: { check: 'bench/corpus/oracle-verify-sanity' } }, null, 2)
    );
    const transcript = path.join(tmpProj, 'session.jsonl');
    fs.writeFileSync(
      transcript,
      '{"type":"user","message":{"role":"user","content":"run npm run check"}}\n'
    );
    const r = spawnSync(
      process.execPath,
      [
        path.join(pluginRoot, 'scripts/session-capture.cjs'),
        '--project-root',
        tmpProj,
        '--plugin-root',
        tmpPlugin,
        '--transcript-path',
        transcript,
        '--json',
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          AGENTIC_SWE_EVOLVE_ON_STOP: '1',
          AGENTIC_SWE_EVOLVE_SKILLS: 'dry-run',
        },
      }
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const payload = JSON.parse(r.stdout.trim());
    const scaffoldRow = payload.evolve?.ritual_skill_scaffold?.results?.find((x) => x.skill === 'team-verify');
    assert.ok(scaffoldRow?.dry_run);
    const promoteRow = payload.evolve?.ritual_skill_promote?.results?.find((x) => x.skill === 'check');
    assert.ok(promoteRow?.dry_run);
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });
});
