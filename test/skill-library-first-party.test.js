'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  LIBRARY_CONFIG,
  SUITE_ID,
  REQUIRED_DOMAINS,
  loadFirstPartyLibrary,
  computeLibraryAttestationDigest,
  verifyFirstPartySkill,
  verifyFirstPartyLibrary,
} = require('../scripts/lib/skills/first-party-library.cjs');
const { checkEvalAttestation, digestSkillBody } = require('../scripts/lib/skills/skill-integrity.cjs');
const { validateSkillManifest } = require('../scripts/lib/skills/skill-manifest.cjs');

const pluginRoot = path.join(__dirname, '..');
const tmpRoot = path.join(__dirname, '_tmp-skill-library-first-party');

describe('AE-029a first-party skill library (contracts + tests)', () => {
  before(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('checklist maps >=10 skills across all eight §8 domains', () => {
    const lib = loadFirstPartyLibrary(pluginRoot);
    assert.ok(lib.skills.length >= 10);
    const domains = new Set(lib.skills.map((s) => s.domain));
    for (const d of REQUIRED_DOMAINS) {
      assert.ok(domains.has(d), `missing domain ${d}`);
    }
    assert.equal(REQUIRED_DOMAINS.length, 8);
  });

  it('each library skill has schema-valid contract (inputs/outputs/permissions) + CONTRACT.md', () => {
    const lib = loadFirstPartyLibrary(pluginRoot);
    for (const entry of lib.skills) {
      const r = verifyFirstPartySkill(pluginRoot, entry);
      assert.equal(r.ok, true, `${entry.name}: ${JSON.stringify(r)}`);
      const man = JSON.parse(
        fs.readFileSync(path.join(pluginRoot, 'skills', entry.name, 'manifest.json'), 'utf8')
      );
      const check = validateSkillManifest(man);
      assert.equal(check.ok, true, entry.name);
      assert.ok(Array.isArray(man.inputs));
      assert.ok(Array.isArray(man.outputs));
      assert.ok(Array.isArray(man.permissions));
      assert.ok(fs.existsSync(path.join(pluginRoot, 'skills', entry.name, 'CONTRACT.md')));
    }
  });

  it('each skill digest pins SKILL.md body; blank digest fails closed', () => {
    const lib = loadFirstPartyLibrary(pluginRoot);
    for (const entry of lib.skills) {
      const skillDir = path.join(pluginRoot, 'skills', entry.name);
      const raw = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
      const man = JSON.parse(fs.readFileSync(path.join(skillDir, 'manifest.json'), 'utf8'));
      assert.equal(man.digest, digestSkillBody(raw), entry.name);
    }

    const probe = verifyFirstPartySkill(pluginRoot, { name: 'repo-scan', domain: 'Repository analysis' });
    assert.equal(probe.ok, true);

    // Staging a blank-digest copy must fail (write-time vs gate-time).
    const staging = path.join(tmpRoot, 'blank-digest');
    fs.cpSync(path.join(pluginRoot, 'skills', 'repo-scan'), staging, { recursive: true });
    const fakeRoot = path.join(tmpRoot, 'fake-pack-blank');
    fs.mkdirSync(path.join(fakeRoot, 'skills'), { recursive: true });
    fs.cpSync(staging, path.join(fakeRoot, 'skills', 'repo-scan'), { recursive: true });
    const manPath = path.join(fakeRoot, 'skills', 'repo-scan', 'manifest.json');
    const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
    // Omit digest entirely so schema still passes; gate must treat missing digest as blank.
    delete man.digest;
    fs.writeFileSync(manPath, `${JSON.stringify(man, null, 2)}\n`);
    const bad = verifyFirstPartySkill(fakeRoot, { name: 'repo-scan', domain: 'Repository analysis' });
    assert.equal(bad.ok, false);
    assert.ok(
      (bad.errors || []).some((e) => /digest blank/i.test(e)),
      JSON.stringify(bad)
    );

    // Wrong digest (valid hex) fails closed as DIGEST_MISMATCH / CONTRACT_INVALID.
    man.digest = 'a'.repeat(64);
    fs.writeFileSync(manPath, `${JSON.stringify(man, null, 2)}\n`);
    const mismatch = verifyFirstPartySkill(fakeRoot, { name: 'repo-scan', domain: 'Repository analysis' });
    assert.equal(mismatch.ok, false);
    assert.ok((mismatch.errors || []).some((e) => /DIGEST_MISMATCH|digest/i.test(e)));
  });

  it('eval attestation is AE-024b-compatible and matches recomputed suite digest', () => {
    const lib = loadFirstPartyLibrary(pluginRoot);
    assert.equal(lib.attestation.suite_id, SUITE_ID);
    assert.equal(checkEvalAttestation(lib.attestation).ok, true);
    const recomputed = computeLibraryAttestationDigest(pluginRoot, lib);
    assert.equal(lib.attestation.result_digest, recomputed);

    for (const entry of lib.skills) {
      const att = JSON.parse(
        fs.readFileSync(path.join(pluginRoot, 'skills', entry.name, 'eval-attestation.json'), 'utf8')
      );
      assert.equal(checkEvalAttestation(att).ok, true, entry.name);
      assert.equal(att.result_digest, recomputed, entry.name);
      // Self-declared status alone is insufficient.
      assert.equal(checkEvalAttestation({ eval_status: 'evaluated' }).ok, false);
    }
  });

  it('full library verify passes offline with zero paid-LLM dependency', () => {
    const report = verifyFirstPartyLibrary(pluginRoot);
    assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
    assert.ok(report.total >= 10);
    assert.deepEqual(report.domains.slice().sort(), [...new Set(report.domains)].sort());
    for (const d of REQUIRED_DOMAINS) assert.ok(report.domains.includes(d));

    const libRaw = fs.readFileSync(path.join(pluginRoot, LIBRARY_CONFIG), 'utf8');
    assert.equal(/openai|anthropic|paid\s*llm/i.test(libRaw), false);
  });

  it('corrupt or missing library / skill fails closed (no swallowed exceptions)', () => {
    const missingRoot = path.join(tmpRoot, 'missing-lib');
    fs.mkdirSync(missingRoot, { recursive: true });
    assert.throws(() => loadFirstPartyLibrary(missingRoot), (err) => err.code === 'LIBRARY_MISSING');

    const badJsonRoot = path.join(tmpRoot, 'bad-json');
    fs.mkdirSync(path.join(badJsonRoot, 'config'), { recursive: true });
    fs.writeFileSync(path.join(badJsonRoot, LIBRARY_CONFIG), '{not-json');
    assert.throws(() => loadFirstPartyLibrary(badJsonRoot), (err) => err.code === 'LIBRARY_INVALID');

    const blankEntryRoot = path.join(tmpRoot, 'blank-entry');
    fs.mkdirSync(path.join(blankEntryRoot, 'config'), { recursive: true });
    fs.writeFileSync(
      path.join(blankEntryRoot, LIBRARY_CONFIG),
      JSON.stringify({
        version: 1,
        skills: [
          { name: 'x', domain: 'Development' },
          { name: 'y', domain: 'Testing' },
          { name: 'z', domain: 'Code review' },
          { name: 'a', domain: 'Security' },
          { name: 'b', domain: 'Architecture' },
          { name: 'c', domain: 'Documentation' },
          { name: 'd', domain: 'CI/CD' },
          { name: 'e', domain: 'Repository analysis' },
          { name: 'f', domain: 'Development' },
          { name: '  ', domain: 'Testing' },
        ],
      })
    );
    assert.throws(() => loadFirstPartyLibrary(blankEntryRoot), (err) => err.code === 'LIBRARY_INVALID');

    const unknown = verifyFirstPartySkill(pluginRoot, { name: 'no-such-skill-zz', domain: 'Development' });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, 'SKILL_MISSING');
  });

  it('stale attestation after contract change is detected at gate time', () => {
    const fakeRoot = path.join(tmpRoot, 'stale-att');
    fs.mkdirSync(path.join(fakeRoot, 'config'), { recursive: true });
    fs.mkdirSync(path.join(fakeRoot, 'skills'), { recursive: true });
    const lib = loadFirstPartyLibrary(pluginRoot);
    // Copy all ten skills then mutate one contract permission and leave attestation pinned.
    for (const entry of lib.skills) {
      fs.cpSync(path.join(pluginRoot, 'skills', entry.name), path.join(fakeRoot, 'skills', entry.name), {
        recursive: true,
      });
    }
    const victim = lib.skills[0].name;
    const manPath = path.join(fakeRoot, 'skills', victim, 'manifest.json');
    const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
    man.permissions = [...man.permissions, 'fs.admin:never'];
    fs.writeFileSync(manPath, `${JSON.stringify(man, null, 2)}\n`);
    fs.writeFileSync(
      path.join(fakeRoot, LIBRARY_CONFIG),
      JSON.stringify({ ...lib, attestation: { ...lib.attestation } }, null, 2)
    );
    const report = verifyFirstPartyLibrary(fakeRoot);
    assert.equal(report.ok, false);
    assert.ok((report.errors || []).some((e) => /digest mismatch|stale/i.test(e)));
  });

  it('null/undefined skill entry is rejected without throwing into a swallowed catch', () => {
    const r1 = verifyFirstPartySkill(pluginRoot, null);
    assert.equal(r1.ok, false);
    const r2 = verifyFirstPartySkill(pluginRoot, { name: null, domain: 'Development' });
    assert.equal(r2.ok, false);
    const r3 = verifyFirstPartySkill(pluginRoot, { name: 'repo-scan', domain: '' });
    assert.equal(r3.ok, false);
  });
});
