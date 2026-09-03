'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseTranscriptFile, textFromJsonlLine } = require('../scripts/lib/memory/session-ingest.cjs');
const { routeSkills } = require('../scripts/lib/skills/skill-router.cjs');

describe('session ingest', () => {
  it('extracts text from cursor jsonl format', () => {
    const line = {
      role: 'user',
      message: { content: [{ type: 'text', text: 'Decision: use work-engine for transitions.' }] },
    };
    assert.match(textFromJsonlLine(line), /work-engine/);
  });

  it('parses transcript file into turns', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-'));
    const f = path.join(tmp, 'demo.jsonl');
    fs.writeFileSync(
      f,
      JSON.stringify({
        role: 'user',
        message: { content: [{ type: 'text', text: 'Lesson: always run npm test before merge.' }] },
      }) + '\n'
    );
    const p = parseTranscriptFile(f);
    assert.ok(p.turns.length >= 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('skill router', () => {
  const root = path.join(__dirname, '..');

  it('returns evaluated skills with autonomous_allowed', () => {
    const r = routeSkills({ pluginRoot: root, query: 'check budget transition', k: 5 });
    assert.ok(r.results.length > 0);
    const check = r.results.find((x) => x.name === 'check');
    if (check) {
      assert.strictEqual(check.eval_status, 'evaluated');
      assert.strictEqual(check.autonomous_allowed, true);
    }
  });

  it('flags unevaluated skills in results', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'route-uneval-'));
    fs.mkdirSync(path.join(tmp, 'skills', 'eval-demo'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'skills', 'uneval-demo'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'skills', 'eval-demo', 'SKILL.md'),
      `---
name: eval-demo
description: "Budget transition check helper."
metadata:
  kind: "command"
  eval_status: "evaluated"
  eval_ref: "x"
  version: "1.0.0"
  provenance: "test"
---
# ok
`
    );
    fs.writeFileSync(
      path.join(tmp, 'skills', 'uneval-demo', 'SKILL.md'),
      `---
name: uneval-demo
description: "Budget transition check helper unevaluated."
metadata:
  kind: "command"
  eval_status: "unevaluated"
  eval_ref: ""
  version: "1.0.0"
  provenance: "test"
---
# body
`
    );
    const r = routeSkills({ pluginRoot: tmp, query: 'budget transition check', k: 5 });
    const uneval = r.results.find((x) => x.name === 'uneval-demo');
    assert.ok(uneval);
    assert.strictEqual(uneval.autonomous_allowed, false);
    assert.match(String(uneval.flag), /unevaluated/);
    assert.ok(r.unevaluated_in_top_k >= 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('boosts skills named in project memory chunks over equal lexical peers', async () => {
    const { routeSkillsWithMemory } = require('../scripts/lib/skills/skill-router.cjs');
    const { ingestTranscripts } = require('../scripts/lib/memory/session-ingest.cjs');
    const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'route-plug-'));
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'route-proj-'));
    const skillMd = (name) => `---
name: ${name}
description: "Generic helper for doing the work."
metadata:
  kind: "command"
  eval_status: "evaluated"
  eval_ref: "x"
  version: "1.0.0"
  provenance: "test"
---
# ${name}
`;
    fs.mkdirSync(path.join(tmpPlugin, 'skills', 'alpha-helper'), { recursive: true });
    fs.mkdirSync(path.join(tmpPlugin, 'skills', 'zeta-helper'), { recursive: true });
    fs.mkdirSync(path.join(tmpPlugin, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmpPlugin, 'skills', 'alpha-helper', 'SKILL.md'), skillMd('alpha-helper'));
    fs.writeFileSync(path.join(tmpPlugin, 'skills', 'zeta-helper', 'SKILL.md'), skillMd('zeta-helper'));
    fs.copyFileSync(
      path.join(__dirname, '..', 'config', 'memory.default.json'),
      path.join(tmpPlugin, 'config', 'memory.default.json')
    );
    const transcript = path.join(tmpProj, 'session.jsonl');
    fs.writeFileSync(
      transcript,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: 'Team always uses zeta-helper for doing the work on this repo.',
        },
      })}\n`
    );
    await ingestTranscripts({
      projectRoot: tmpProj,
      pluginRoot: tmpPlugin,
      transcriptPaths: [transcript],
      maxFiles: 2,
    });
    const plain = routeSkills({ pluginRoot: tmpPlugin, query: 'doing the work', k: 5 });
    const mem = await routeSkillsWithMemory({
      pluginRoot: tmpPlugin,
      projectRoot: tmpProj,
      query: 'doing the work',
      k: 5,
    });
    assert.strictEqual(plain.results[0].name, 'alpha-helper');
    assert.strictEqual(mem.results[0].name, 'zeta-helper');
    assert.ok(mem.results[0].memory_boost > 0);
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });

  it('boosts skills referenced by evaluated procedure npm run rituals', async () => {
    const { routeSkillsWithMemory } = require('../scripts/lib/skills/skill-router.cjs');
    const { promoteOrDemote } = require('../scripts/lib/descent/promotion.cjs');
    const { buildFingerprint } = require('../scripts/lib/descent/fingerprint.cjs');
    const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'route-rit-'));
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'route-rit-p-'));
    const skillMd = (name) => `---
name: ${name}
description: "Generic helper for doing the work."
metadata:
  kind: "command"
  eval_status: "evaluated"
  eval_ref: "x"
  version: "1.0.0"
  provenance: "test"
---
# ${name}
`;
    fs.mkdirSync(path.join(tmpPlugin, 'skills', 'alpha-helper'), { recursive: true });
    fs.mkdirSync(path.join(tmpPlugin, 'skills', 'zeta-helper'), { recursive: true });
    fs.writeFileSync(path.join(tmpPlugin, 'skills', 'alpha-helper', 'SKILL.md'), skillMd('alpha-helper'));
    fs.writeFileSync(path.join(tmpPlugin, 'skills', 'zeta-helper', 'SKILL.md'), skillMd('zeta-helper'));
    const verify = 'npm run zeta-helper';
    promoteOrDemote({
      projectRoot: tmpProj,
      fingerprint: buildFingerprint({ files: ['package.json'], verifyCommand: verify }),
      procedure: {
        actions: [{ type: 'READ_FILE', path: 'package.json' }],
        verify: [{ type: 'RUN', command: verify }],
        _meta: { source: 'repo-ritual' },
      },
      evalPassed: true,
      humanApproved: true,
    });
    const mem = await routeSkillsWithMemory({
      pluginRoot: tmpPlugin,
      projectRoot: tmpProj,
      query: 'doing the work',
      k: 5,
    });
    assert.strictEqual(mem.results[0].name, 'zeta-helper');
    assert.ok(mem.results[0].memory_boost >= 2.5);
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });

  it('boosts skills mentioned in fleet submission memory chunks', async () => {
    const { routeSkillsWithMemory } = require('../scripts/lib/skills/skill-router.cjs');
    const { ingestFleetSubmissionMemory } = require('../scripts/lib/fleet/ingest-fleet-memory.cjs');
    const tmpPlugin = fs.mkdtempSync(path.join(os.tmpdir(), 'route-fleet-'));
    const tmpProj = fs.mkdtempSync(path.join(os.tmpdir(), 'route-fleet-p-'));
    const skillMd = (name) => `---
name: ${name}
description: "Generic helper for doing the work."
metadata:
  kind: "command"
  eval_status: "evaluated"
  eval_ref: "x"
  version: "1.0.0"
  provenance: "test"
---
# ${name}
`;
    fs.mkdirSync(path.join(tmpPlugin, 'skills', 'alpha-helper'), { recursive: true });
    fs.mkdirSync(path.join(tmpPlugin, 'skills', 'zeta-helper'), { recursive: true });
    fs.mkdirSync(path.join(tmpPlugin, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmpPlugin, 'skills', 'alpha-helper', 'SKILL.md'), skillMd('alpha-helper'));
    fs.writeFileSync(path.join(tmpPlugin, 'skills', 'zeta-helper', 'SKILL.md'), skillMd('zeta-helper'));
    fs.copyFileSync(
      path.join(__dirname, '..', 'config', 'memory.default.json'),
      path.join(tmpPlugin, 'config', 'memory.default.json')
    );
    const archivePath = path.join(tmpPlugin, 'bench', 'results', 'fleet-submissions', 'fleet-test.json');
    fs.mkdirSync(path.dirname(archivePath), { recursive: true });
    fs.writeFileSync(archivePath, '{}');
    await ingestFleetSubmissionMemory({
      submission: {
        project_root: tmpProj,
        fleet_evidence_class: 'maintainer_dogfood',
        evidence: {
          submission_readiness: { organic_live: 3, portfolio_multiplier: 0.01 },
          procedures: { evaluated: 2, ritual_skills: ['zeta-helper'] },
        },
      },
      pluginRoot: tmpPlugin,
      archivePath,
    });
    const mem = await routeSkillsWithMemory({
      pluginRoot: tmpPlugin,
      projectRoot: tmpProj,
      query: 'doing the work',
      k: 5,
    });
    assert.strictEqual(mem.results[0].name, 'zeta-helper');
    assert.ok(mem.results[0].memory_boost > 0);
    fs.rmSync(tmpPlugin, { recursive: true, force: true });
    fs.rmSync(tmpProj, { recursive: true, force: true });
  });
});

describe('session-skill-route-hint fleet', () => {
  const root = path.join(__dirname, '..');

  it('surfaces fleet blockers for consumer repos', () => {
    const { spawnSync } = require('node:child_process');
    const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'hint-fleet-'));
    const r = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/session-skill-route-hint.cjs'), '--project-root', consumer, '--plugin-root', root],
      { encoding: 'utf8', env: { ...process.env, AGENTIC_SWE_SKILL_ROUTE_QUERY: 'implement feature' } }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /Fleet muscle memory \(consumer repo\)/);
    assert.match(r.stdout, /\*\*Submission ready:\*\* false/);
    fs.rmSync(consumer, { recursive: true, force: true });
  });

  it('shows fleet hints without skill route query in consumer mode', () => {
    const { spawnSync } = require('node:child_process');
    const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'hint-fleet-noq-'));
    const r = spawnSync(
      process.execPath,
      [path.join(root, 'scripts/session-skill-route-hint.cjs'), '--project-root', consumer, '--plugin-root', root],
      { encoding: 'utf8', env: { ...process.env, AGENTIC_SWE_SKILL_ROUTE_QUERY: '' } }
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /Fleet muscle memory \(consumer repo\)/);
    fs.rmSync(consumer, { recursive: true, force: true });
  });
});
