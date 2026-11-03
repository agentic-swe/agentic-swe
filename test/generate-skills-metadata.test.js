'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

describe('generate-skills metadata', () => {
  it('does not duplicate metadata keys in generated SKILL.md', () => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/generate-skills.cjs')], {
      encoding: 'utf8',
      cwd: root,
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const sample = fs.readFileSync(path.join(root, 'skills/verification/SKILL.md'), 'utf8');
    const metaBlock = sample.split('metadata:')[1]?.split('---')[0] || '';
    const evalCount = (metaBlock.match(/eval_status:/g) || []).length;
    assert.strictEqual(evalCount, 1, 'eval_status should appear once in metadata');
  });

  it('never emits forbidden per-file upstream provenance keys in skill metadata', () => {
    const r = spawnSync(process.execPath, [path.join(root, 'scripts/generate-skills.cjs')], {
      encoding: 'utf8',
      cwd: root,
    });
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const skillsRoot = path.join(root, 'skills');
    const forbidden = /\b(upstream_repo|upstream_commit|rewritten)\s*:/;
    const offenders = [];
    for (const name of fs.readdirSync(skillsRoot)) {
      const skillPath = path.join(skillsRoot, name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) continue;
      const text = fs.readFileSync(skillPath, 'utf8');
      const metaBlock = text.split('metadata:')[1]?.split(/\n---/)[0] || '';
      if (forbidden.test(metaBlock)) offenders.push(name);
    }
    assert.deepStrictEqual(offenders, [], `forbidden provenance keys in: ${offenders.join(', ')}`);
  });
});

describe('session-skill-route-hint', () => {
  it('exits cleanly with no active work', () => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'skill-route-'));
    const r = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/session-skill-route-hint.cjs'), '--project-root', tmp],
      { encoding: 'utf8', env: { ...process.env, AGENTIC_SWE_SKILL_ROUTE_HINT: '1' } }
    );
    assert.strictEqual(r.status, 0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('descent learning curve bench', () => {
  it('produces monotonic improvement curve', () => {
    const out = path.join(__dirname, '_tmp-learning-curve.json');
    const r = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/bench/run-descent-learning-curve.cjs'), '--out', out],
      { encoding: 'utf8', cwd: root }
    );
    assert.strictEqual(r.status, 0, r.stderr + r.stdout);
    const payload = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(payload.curve.length >= 2);
    const first = payload.curve[0].portfolio_multiplier;
    const last = payload.curve[payload.curve.length - 1].portfolio_multiplier;
    assert.ok(last <= first, 'learning should not increase portfolio multiplier');
    fs.unlinkSync(out);
  });
});
