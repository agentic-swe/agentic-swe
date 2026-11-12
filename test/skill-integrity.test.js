'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  digestSkillBody,
  verifySkillDigest,
  emptyLockfile,
  lockPin,
  resolveLockPin,
  writeLockfileAtomic,
  readLockfile,
  checkEvalAttestation,
  isShadowTrusted,
} = require('../scripts/lib/skills/skill-integrity.cjs');
const { resolveSkill } = require('../scripts/lib/skills/project-skills.cjs');
const { checkSkillEvalGate } = require('../scripts/lib/skills/eval-gate.cjs');

const pluginRoot = path.resolve(__dirname, '..');
const tmpRoot = path.join(__dirname, '_tmp-skill-integrity');

const SAMPLE_MD = `---
name: demo
description: "Demo skill body."
metadata:
  version: "1.0.0"
  eval_status: "evaluated"
  eval_ref: ""
---
# Hello body
line two
`;

describe('AE-024b digest / lockfile / shadow / attestation', () => {
  before(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(tmpRoot, { recursive: true });
  });
  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('changing SKILL.md body without updating digest fails verify', () => {
    const digest = digestSkillBody(SAMPLE_MD);
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(verifySkillDigest(SAMPLE_MD, digest).ok, true);
    const tampered = SAMPLE_MD.replace('Hello body', 'Hello pwned');
    const bad = verifySkillDigest(tampered, digest);
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'DIGEST_MISMATCH');
  });

  it('lockfile pin returns same digest; tampering fails closed', () => {
    const lockPath = path.join(tmpRoot, 'skills-lock.json');
    const digest = digestSkillBody(SAMPLE_MD);
    const lock = emptyLockfile();
    lockPin(lock, 'demo', { version: '1.0.0', digest });
    writeLockfileAtomic(lockPath, lock);
    const loaded = readLockfile(lockPath);
    const ok = resolveLockPin(loaded, 'demo', SAMPLE_MD);
    assert.equal(ok.ok, true);
    assert.equal(ok.digest, digest);

    const tamperedBody = SAMPLE_MD.replace('line two', 'line evil');
    const bad = resolveLockPin(loaded, 'demo', tamperedBody);
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'LOCK_TAMPERED');

    loaded.skills.demo.digest = 'deadbeef';
    const blankish = resolveLockPin(loaded, 'demo', SAMPLE_MD);
    assert.equal(blankish.ok, false);

    // Empty digest in lock fails closed even without body.
    loaded.skills.demo.digest = '';
    const empty = resolveLockPin(loaded, 'demo');
    assert.equal(empty.ok, false);
    assert.equal(empty.code, 'LOCK_TAMPERED');
  });

  it('project shadow of pack skill rejected for autonomous unless trust; trust → shadow explicit', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-trust-'));
    // Use a real pack skill name
    const packSkill = 'code-reviewer';
    assert.ok(fs.existsSync(path.join(pluginRoot, 'skills', packSkill, 'SKILL.md')));
    const skillDir = path.join(proj, '.agentic-swe', 'skills', packSkill);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: ${packSkill}
description: "Shadowing project skill."
metadata:
  tier: "L2"
  eval_status: "unevaluated"
  eval_ref: ""
  version: "1.0.0"
  provenance: "test"
---
# project body
`
    );

    const denied = resolveSkill({
      pluginRoot,
      projectRoot: proj,
      skillName: packSkill,
      autonomous: true,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'SHADOW_UNTRUSTED');
    assert.equal(denied.shadow, 'implicit');

    const gateDenied = checkSkillEvalGate({
      pluginRoot,
      projectRoot: proj,
      skillName: packSkill,
      autonomous: true,
    });
    assert.equal(gateDenied.allowed, false);
    assert.equal(gateDenied.shadow, 'implicit');

    fs.writeFileSync(
      path.join(proj, '.agentic-swe', 'skill-trust.json'),
      JSON.stringify({ version: 1, shadows: { [packSkill]: { allow: true, note: 'test' } } }, null, 2)
    );
    assert.equal(isShadowTrusted(proj, packSkill), true);

    const allowed = resolveSkill({
      pluginRoot,
      projectRoot: proj,
      skillName: packSkill,
      autonomous: true,
    });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.shadow, 'explicit');

    fs.rmSync(proj, { recursive: true, force: true });
  });

  it('self-attested eval_status alone does not satisfy attestation', () => {
    assert.equal(checkEvalAttestation(null).ok, false);
    assert.equal(checkEvalAttestation({ eval_status: 'evaluated' }).ok, false);
    assert.equal(checkEvalAttestation({ suite_id: 'x' }).ok, false);
    const good = checkEvalAttestation({
      suite_id: 'bench/corpus/oracle-verify-sanity',
      result_digest: 'a'.repeat(64),
      timestamp: '2026-11-12T00:00:00Z',
    });
    assert.equal(good.ok, true);

    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'att-only-'));
    const skillDir = path.join(proj, '.agentic-swe', 'skills', 'att-demo');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: att-demo
description: "Evaluated without attestation."
metadata:
  tier: "L2"
  eval_status: "evaluated"
  eval_ref: ""
  version: "1.0.0"
  provenance: "test"
---
# body
`
    );
    const gate = checkSkillEvalGate({
      pluginRoot,
      projectRoot: proj,
      skillName: 'att-demo',
      autonomous: true,
    });
    assert.equal(gate.allowed, false);
    assert.match(String(gate.reason), /attestation/i);
    fs.rmSync(proj, { recursive: true, force: true });
  });

  it('eval-gate still fail-closed for lint_passed', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-pass-'));
    const skillDir = path.join(proj, '.agentic-swe', 'skills', 'lint-only');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: lint-only
description: "Lint passed only."
metadata:
  tier: "L2"
  eval_status: "lint_passed"
  eval_ref: "bench/corpus/oracle-catalog-lint"
  version: "1.0.0"
  provenance: "test"
---
# body
`
    );
    const gate = checkSkillEvalGate({
      pluginRoot,
      projectRoot: proj,
      skillName: 'lint-only',
      autonomous: true,
    });
    assert.equal(gate.allowed, false);
    assert.equal(gate.eval_status, 'lint_passed');
    fs.rmSync(proj, { recursive: true, force: true });
  });
});
