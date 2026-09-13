'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { checkSkillEvalGate } = require('../scripts/lib/skills/eval-gate.cjs');

describe('skill eval gate (fail-closed)', () => {
  const root = path.join(__dirname, '..');

  it('blocks hypothetical unevaluated skill', () => {
    const tmp = path.join(__dirname, '_tmp-uneval-skill');
    const skillDir = path.join(tmp, 'skills', 'uneval-demo');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: uneval-demo
description: "Test skill. Use when testing eval gate."
metadata:
  tier: "L2"
  eval_status: "unevaluated"
  eval_ref: ""
  version: "1.0.0"
  provenance: "test"
---
# body
`
    );
    const gate = checkSkillEvalGate({
      pluginRoot: tmp,
      skillName: 'uneval-demo',
      autonomous: true,
    });
    assert.strictEqual(gate.allowed, false);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('allows manual override with allow-manual semantics', () => {
    const gate = checkSkillEvalGate({
      pluginRoot: root,
      skillName: 'seo-specialist',
      autonomous: false,
    });
    assert.strictEqual(gate.allowed, true);
  });

  it('blocks unknown skill names for autonomous use', () => {
    const gate = checkSkillEvalGate({
      pluginRoot: root,
      skillName: 'nonexistent-skill-xyz',
      autonomous: true,
    });
    assert.strictEqual(gate.allowed, false);
    assert.strictEqual(gate.eval_status, 'unevaluated');
  });

  it('allows unknown skill names only when not autonomous', () => {
    const gate = checkSkillEvalGate({
      pluginRoot: root,
      skillName: 'nonexistent-skill-xyz',
      autonomous: false,
    });
    assert.strictEqual(gate.allowed, true);
  });

  it('allows evaluated skill when eval_ref present', () => {
    const tmp = path.join(__dirname, '_tmp-eval-skill');
    const skillDir = path.join(tmp, 'skills', 'evaluated-demo');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---
name: evaluated-demo
description: "Test evaluated skill. Use when testing eval gate."
metadata:
  tier: "L1"
  eval_status: "evaluated"
  eval_ref: "bench/corpus/oracle-readme-badge"
  version: "1.0.0"
  provenance: "test"
---
# body
`
    );
    const gate = checkSkillEvalGate({
      pluginRoot: tmp,
      skillName: 'evaluated-demo',
      autonomous: true,
    });
    assert.strictEqual(gate.allowed, true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
