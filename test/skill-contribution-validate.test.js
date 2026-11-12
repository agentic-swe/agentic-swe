'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  validateSkillContribution,
  formatContributionResult,
  contributionFixturePaths,
  runContributionSelfCheck,
} = require('../scripts/lib/skills/skill-contribution-validate.cjs');
const { digestSkillBody } = require('../scripts/lib/skills/skill-integrity.cjs');

const root = path.resolve(__dirname, '..');
const fixtures = contributionFixturePaths(root);
const tmpRoot = path.join(__dirname, '_tmp-skill-contribution');
const cli = path.join(root, 'scripts', 'skill-contribution-validate.cjs');

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    env: process.env,
  });
}

describe('AE-028a skill contribution templates + validation', () => {
  before(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('template files exist and are linked from docs', () => {
    const required = [
      'CONTRIBUTING.md',
      'docs/skill-contribution.md',
      '.github/ISSUE_TEMPLATE/skill_submission.md',
      '.github/PULL_REQUEST_TEMPLATE/skill.md',
      '.github/PULL_REQUEST_TEMPLATE.md',
    ];
    for (const rel of required) {
      assert.ok(fs.existsSync(path.join(root, rel)), `missing ${rel}`);
    }
    const contributing = fs.readFileSync(path.join(root, 'CONTRIBUTING.md'), 'utf8');
    assert.match(contributing, /docs\/skill-contribution\.md/);
    assert.match(contributing, /skill_submission\.md/);
    assert.match(contributing, /PULL_REQUEST_TEMPLATE\/skill\.md/);
    assert.match(contributing, /PD-6/);

    const guide = fs.readFileSync(path.join(root, 'docs/skill-contribution.md'), 'utf8');
    assert.match(guide, /PD-6/);
    assert.match(guide, /external publication/i);
    assert.match(guide, /CONTRIBUTING\.md/);
    assert.match(guide, /skill_submission\.md/);
    assert.match(guide, /PULL_REQUEST_TEMPLATE\/skill\.md/);

    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(readme, /CONTRIBUTING\.md/);
    assert.match(readme, /docs\/skill-contribution\.md/);

    // No CLA / DCO / external publish path introduced by this item.
    for (const rel of ['CONTRIBUTING.md', 'docs/skill-contribution.md']) {
      const text = fs.readFileSync(path.join(root, rel), 'utf8');
      assert.doesNotMatch(text, /\bCLA agreement\b/i);
      assert.doesNotMatch(text, /Developer Certificate of Origin/i);
      assert.doesNotMatch(text, /dco\.yml/i);
    }
  });

  it('good fixture passes; deliberately broken fixtures fail with codes', () => {
    const good = validateSkillContribution(fixtures.good);
    assert.equal(good.ok, true, formatContributionResult(good));
    assert.equal(good.name, 'contrib-good-example');
    assert.match(good.digest, /^[a-f0-9]{64}$/);
    assert.ok(good.checks.every((c) => c.ok));

    const expectFail = {
      'contrib-broken-digest': 'DIGEST_MISMATCH',
      'contrib-broken-manifest': 'MANIFEST_INVALID',
      'contrib-blank-digest': 'DIGEST_MISSING',
      'contrib-corrupt-manifest': 'MANIFEST_PARSE',
      'contrib-missing-skill-md': 'SKILL_MD_MISSING',
      'contrib-broken-contract': 'CONTRACT_TEST_FAILED',
    };

    for (const broken of fixtures.broken) {
      const r = validateSkillContribution(broken);
      assert.equal(r.ok, false, `expected fail for ${broken}`);
      const base = path.basename(broken);
      const code = expectFail[base];
      assert.ok(code, `missing expectation for ${base}`);
      assert.equal(r.code, code, `${base}: ${formatContributionResult(r)}`);
    }
  });

  it('blank path / missing path / blank SKILL.md fail closed (no skip)', () => {
    const blankPath = validateSkillContribution('   ');
    assert.equal(blankPath.ok, false);
    assert.equal(blankPath.code, 'PATH_BLANK');

    const missing = validateSkillContribution(path.join(tmpRoot, 'no-such-dir'));
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'PATH_MISSING');

    const dir = path.join(tmpRoot, 'blank-skill-md');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '   \n');
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        name: 'blank-skill-md',
        version: '1.0.0',
        description: 'x',
        kind: 'prompt',
        inputs: [],
        outputs: [],
        dependencies: [],
        permissions: [],
        runtime: { node: '>=22' },
        compatibility: { pack: '^3' },
        validation: { rules: ['schema'] },
        provenance: { origin: 'first-party' },
        maintainer: 't',
        digest: 'a'.repeat(64),
      })
    );
    // Directory name must match for later checks; rename layout:
    fs.rmSync(dir, { recursive: true, force: true });
    const named = path.join(tmpRoot, 'blank-body');
    fs.mkdirSync(named, { recursive: true });
    fs.writeFileSync(path.join(named, 'SKILL.md'), '');
    const blankMd = validateSkillContribution(named);
    assert.equal(blankMd.ok, false);
    assert.equal(blankMd.code, 'SKILL_MD_BLANK');
  });

  it('digest drift after write-time pin fails at gate time', () => {
    const dir = path.join(tmpRoot, 'drift-skill');
    fs.mkdirSync(dir, { recursive: true });
    const skillMd = `---
name: drift-skill
description: "Digest drift fixture."
metadata:
  version: "1.0.0"
  eval_status: "unevaluated"
  eval_ref: ""
---
# Original body
`;
    const digest = digestSkillBody(skillMd);
    fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd);
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(
        {
          name: 'drift-skill',
          version: '1.0.0',
          description: 'Digest drift fixture.',
          kind: 'prompt',
          inputs: [],
          outputs: [],
          dependencies: [],
          permissions: [],
          runtime: { node: '>=22.0.0' },
          compatibility: { pack: '^3.0.0' },
          validation: { rules: ['schema'] },
          provenance: { origin: 'first-party', authors: ['test'] },
          maintainer: 'test',
          digest,
        },
        null,
        2
      )
    );
    assert.equal(validateSkillContribution(dir).ok, true);

    fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd.replace('Original body', 'Tampered body'));
    const bad = validateSkillContribution(dir);
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'DIGEST_MISMATCH');
  });

  it('banned install scripts fail; corrupt package.json scripts fail closed', () => {
    const dir = path.join(tmpRoot, 'scripts-skill');
    fs.mkdirSync(dir, { recursive: true });
    const skillMd = `---
name: scripts-skill
description: "Install scripts forbidden."
metadata:
  version: "1.0.0"
  eval_status: "unevaluated"
  eval_ref: ""
---
# Body
`;
    const digest = digestSkillBody(skillMd);
    fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd);
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        name: 'scripts-skill',
        version: '1.0.0',
        description: 'Install scripts forbidden.',
        kind: 'prompt',
        inputs: [],
        outputs: [],
        dependencies: [],
        permissions: [],
        runtime: { node: '>=22.0.0' },
        compatibility: { pack: '^3.0.0' },
        validation: { rules: ['schema'] },
        provenance: { origin: 'first-party', authors: ['test'] },
        maintainer: 'test',
        digest,
      })
    );
    fs.writeFileSync(path.join(dir, 'postinstall.js'), 'console.log(1)\n');
    const banned = validateSkillContribution(dir);
    assert.equal(banned.ok, false);
    assert.equal(banned.code, 'INSTALL_SCRIPTS_FORBIDDEN');
    fs.unlinkSync(path.join(dir, 'postinstall.js'));

    fs.writeFileSync(path.join(dir, 'package.json'), '{ not-json');
    const corruptPkg = validateSkillContribution(dir);
    assert.equal(corruptPkg.ok, false);
    assert.equal(corruptPkg.code, 'INSTALL_SCRIPTS_FORBIDDEN');
  });

  it('CLI self-check and path mode; formatted output is visible', () => {
    const self = runCli(['--self-check']);
    assert.equal(self.status, 0, self.stdout + self.stderr);
    assert.match(self.stdout, /skill-contribution-validate: PASS/);
    assert.match(self.stdout, /skill-contribution-validate: FAIL/);
    assert.match(self.stdout, /self-check OK/);

    const pass = runCli([fixtures.good]);
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    assert.match(pass.stdout, /PASS/);

    const fail = runCli([fixtures.broken[0]]);
    assert.equal(fail.status, 1);
    assert.match(fail.stdout, /FAIL/);
    assert.match(fail.stdout, /check digest: FAIL/);

    const libSelf = runContributionSelfCheck(root);
    assert.equal(libSelf.ok, true);
    assert.match(libSelf.summary, /self-check OK/);
  });

  it('formatContributionResult includes check rows for CI visibility', () => {
    const r = validateSkillContribution(fixtures.good);
    const text = formatContributionResult(r);
    assert.match(text, /check path: ok/);
    assert.match(text, /check digest: ok/);
    assert.match(text, /check contract_test: ok/);
  });
});
