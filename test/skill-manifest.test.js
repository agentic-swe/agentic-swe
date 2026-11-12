'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  validateSkillManifest,
  checkManifestCompatibility,
  loadSchema,
  SCHEMA_PATH,
  legacyToManifest,
} = require('../scripts/lib/skills/skill-manifest.cjs');

const root = path.join(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures', 'skill-manifest');
const tmpRoot = path.join(__dirname, '_tmp-skill-manifest-lint');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));
}

function baseValid(overrides = {}) {
  return {
    ...readFixture('valid-prompt.json'),
    ...overrides,
  };
}

describe('AE-024a skill manifest schema + lint', () => {
  it('schema file exists and loads', () => {
    assert.ok(fs.existsSync(SCHEMA_PATH));
    const schema = loadSchema();
    assert.equal(schema.title.includes('Skill Manifest'), true);
    for (const field of [
      'name',
      'version',
      'description',
      'inputs',
      'outputs',
      'dependencies',
      'permissions',
      'runtime',
      'compatibility',
      'validation',
      'provenance',
      'maintainer',
    ]) {
      assert.ok(schema.required.includes(field), `schema requires ${field}`);
    }
  });

  it('valid fixtures pass Ajv', () => {
    for (const file of ['valid-prompt.json', 'valid-executable.json']) {
      const check = validateSkillManifest(readFixture(file));
      assert.equal(check.ok, true, file + ' ' + JSON.stringify(check.errors));
    }
  });

  it('each required §8 field absence fails with a named error path', () => {
    const required = [
      'name',
      'version',
      'description',
      'inputs',
      'outputs',
      'dependencies',
      'permissions',
      'runtime',
      'compatibility',
      'validation',
      'provenance',
      'maintainer',
    ];
    for (const field of required) {
      const m = baseValid();
      delete m[field];
      const check = validateSkillManifest(m);
      assert.equal(check.ok, false, `expected fail without ${field}`);
      const joined = (check.errors || []).join('\n');
      assert.match(joined, new RegExp(`/${field}\\b`), `named path for ${field}: ${joined}`);
    }
  });

  it('execution kind with empty permissions fails; prompt with [] passes', () => {
    const execEmpty = baseValid({
      name: 'exec-empty',
      kind: 'subagent',
      permissions: [],
    });
    const bad = validateSkillManifest(execEmpty);
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'PERMISSIONS_EMPTY_FOR_EXECUTION');

    const missing = baseValid({ name: 'exec-missing', kind: 'command' });
    delete missing.permissions;
    const miss = validateSkillManifest(missing);
    assert.equal(miss.ok, false);
    assert.match((miss.errors || []).join('\n'), /\/permissions/);

    const prompt = baseValid({ name: 'prompt-ok', kind: 'prompt', permissions: [] });
    const ok = validateSkillManifest(prompt);
    assert.equal(ok.ok, true);
  });

  it('incompatible compatibility/runtime ranges fail; compatible pair passes', () => {
    const a = baseValid({
      name: 'compat-a',
      compatibility: { pack: '^3.0.0' },
      runtime: { node: '^22.0.0' },
    });
    const b = baseValid({
      name: 'compat-b',
      compatibility: { pack: '^3.4.0' },
      runtime: { node: '>=22.0.0' },
    });
    const good = checkManifestCompatibility(a, b, { packVersion: '3.4.0', nodeVersion: '22.11.0' });
    assert.equal(good.ok, true, JSON.stringify(good.errors));

    const c = baseValid({
      name: 'compat-c',
      compatibility: { pack: '^2.0.0' },
      runtime: { node: '^18.0.0' },
    });
    const bad = checkManifestCompatibility(a, c, { packVersion: '3.4.0', nodeVersion: '22.11.0' });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'COMPAT_MISMATCH');
    assert.ok(bad.errors.length >= 1);
  });

  it('legacyToManifest marks provenance origin unknown', () => {
    const m = legacyToManifest({
      name: 'legacy-demo',
      description: 'Legacy frontmatter skill',
      meta: { kind: 'prompt', version: '1.0.0', provenance: 'generate-skills' },
    });
    assert.equal(m.provenance.origin, 'unknown');
    const check = validateSkillManifest(m);
    assert.equal(check.ok, true, JSON.stringify(check.errors));
  });

  describe('skill-lint rejects invalid / accepts valid fixtures', () => {
    before(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });
    after(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    function writeSkillTree(skillName, skillMd, manifest) {
      const dir = path.join(tmpRoot, 'skills', skillName);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd);
      if (manifest) {
        fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      }
    }

    function runLint() {
      return spawnSync(process.execPath, [path.join(root, 'scripts', 'skill-lint.cjs'), '--plugin-root', tmpRoot], {
        encoding: 'utf8',
        env: { ...process.env, HOME: process.env.HOME || '/tmp' },
      });
    }

    it('exits non-zero on invalid structured manifest', () => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      const bad = baseValid({ name: 'bad-skill', kind: 'subagent', permissions: [] });
      writeSkillTree(
        'bad-skill',
        `---
name: bad-skill
description: "Invalid execution permissions fixture."
metadata:
  tier: "L2"
  eval_status: "unevaluated"
  eval_ref: ""
  version: "1.0.0"
  provenance: "test"
---
# body
`,
        bad
      );
      const r = runLint();
      assert.notEqual(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stderr, /PERMISSIONS_EMPTY_FOR_EXECUTION|empty undeclared|permissions/i);
    });

    it('exits 0 on valid prompt manifest fixture', () => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      const good = readFixture('valid-prompt.json');
      good.name = 'good-skill';
      writeSkillTree(
        'good-skill',
        `---
name: good-skill
description: "Valid prompt skill fixture."
metadata:
  tier: "L2"
  eval_status: "unevaluated"
  eval_ref: ""
  version: "1.0.0"
  provenance: "test"
---
# body
`,
        good
      );
      const r = runLint();
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /skill-lint: OK/);
    });

    it('argv JSON fixture path: invalid exits non-zero; valid exits 0', () => {
      const invalidPath = path.join(fixtures, '_generated-invalid.json');
      const invalid = baseValid({ name: 'argv-bad' });
      delete invalid.maintainer;
      fs.writeFileSync(invalidPath, JSON.stringify(invalid));
      try {
        const bad = spawnSync(
          process.execPath,
          [path.join(root, 'scripts', 'skill-lint.cjs'), '--plugin-root', root, invalidPath],
          { encoding: 'utf8' }
        );
        // root skills are valid; argv file missing maintainer must fail
        assert.notEqual(bad.status, 0, bad.stdout + bad.stderr);
        assert.match(bad.stderr, /\/maintainer/);

        const goodPath = path.join(fixtures, 'valid-prompt.json');
        const good = spawnSync(
          process.execPath,
          [path.join(root, 'scripts', 'skill-lint.cjs'), '--plugin-root', root, goodPath],
          { encoding: 'utf8' }
        );
        assert.equal(good.status, 0, good.stdout + good.stderr);
      } finally {
        fs.rmSync(invalidPath, { force: true });
      }
    });
  });
});
