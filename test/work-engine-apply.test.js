'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('os');
const path = require('node:path');
const { applyTransition, loadWorkItem } = require('../scripts/lib/work-engine/engine.cjs');
const { requiredArtifactGroups } = require('../scripts/lib/work-engine/artifacts.cjs');

const pluginRoot = path.join(__dirname, '..');

function writeFile(p, body) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, 'utf8');
}

describe('work-engine applyTransition', () => {
  let tmp;
  let workDir;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-'));
    workDir = path.join(tmp, 'demo-work');
    fs.mkdirSync(workDir, { recursive: true });
    const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
    tpl.work_id = 'demo-work';
    tpl.task = 'test';
    tpl.pipeline.track = 'lean';
    tpl.current_state = 'initialized';
    tpl.budget.budget_remaining = 20;
    tpl.budget.cost_used = 0;
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(tpl, null, 2));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('applies initialized → feasibility without destination artifacts (bootstrap)', () => {
    const r = applyTransition({
      workDir,
      pluginRoot,
      to: 'feasibility',
      actor: 'test',
      reason: 'bootstrap',
    });
    assert.strictEqual(r.ok, true, r.message || JSON.stringify(r));
    const l = loadWorkItem(workDir, pluginRoot);
    assert.strictEqual(l.state.current_state, 'feasibility');
    assert.ok(l.state.budget.budget_remaining < 20);
  });

  it('requires feasibility.md (source artifact) before feasibility → lean-track-check', () => {
    // Without feasibility.md, the transition should fail because the source
    // state "feasibility" has not yet produced its required artifact.
    const r = applyTransition({
      workDir,
      pluginRoot,
      to: 'lean-track-check',
      actor: 'test',
    });
    assert.strictEqual(r.ok, false);
    assert.match(String(r.message), /feasibility\.md/);
    // Write only the source artifact — the destination's artifact (lean-track-check.md)
    // must NOT be required at this point (it is produced by the lean-track-check phase).
    writeFile(path.join(workDir, 'feasibility.md'), '# ok\n');
    const r2 = applyTransition({
      workDir,
      pluginRoot,
      to: 'lean-track-check',
      actor: 'test',
    });
    assert.strictEqual(r2.ok, true, r2.message);
  });
});

describe('requiredArtifactGroups — source-state semantics', () => {
  it('initialized has no required artifacts (bootstrap)', () => {
    assert.deepStrictEqual(requiredArtifactGroups('initialized', 'feasibility', {}), []);
  });

  it('feasibility requires only feasibility.md regardless of destination', () => {
    const g = requiredArtifactGroups('feasibility', 'lean-track-check', {});
    assert.deepStrictEqual(g, [['feasibility.md']]);
  });

  it('lean-track-check requires lean-track-check.md (not implementation.md)', () => {
    // Old (broken) code required implementation.md because it looked at the destination
    // lean-track-implementation.  Correct: only the source artifact is checked.
    const g = requiredArtifactGroups('lean-track-check', 'lean-track-implementation', {});
    assert.deepStrictEqual(g, [['lean-track-check.md']]);
  });

  it('lean-track-implementation requires implementation.md + review verdict', () => {
    const g = requiredArtifactGroups('lean-track-implementation', 'validation', {});
    assert.deepStrictEqual(g, [['implementation.md'], ['review-pass.md', 'review-feedback.md']]);
  });

  it('validation requires validation-results.md (not cicd.md or pr-link.txt)', () => {
    // Old code required cicd.md and pr-link.txt when going to pr-creation.
    const g = requiredArtifactGroups('validation', 'pr-creation', {});
    assert.deepStrictEqual(g, [['validation-results.md']]);
  });

  it('pr-creation requires cicd.md and pr-link.txt before leaving', () => {
    const g = requiredArtifactGroups('pr-creation', 'approval-wait', {});
    assert.deepStrictEqual(g, [['cicd.md'], ['pr-link.txt']]);
  });

  it('design going to design-review requires only design.md on first pass', () => {
    const g = requiredArtifactGroups('design', 'design-review', {});
    assert.deepStrictEqual(g, [['design.md']]);
  });

  it('test-strategy requires only test-stubs.md (not test-results.md)', () => {
    // test-results.md is noted as "Phase 2, after implementation" in CLAUDE.md —
    // there is no return edge to test-strategy so it is not enforced here.
    const g = requiredArtifactGroups('test-strategy', 'implementation', {});
    assert.deepStrictEqual(g, [['test-stubs.md']]);
  });

  it('implementation requires only implementation.md on first departure', () => {
    const g = requiredArtifactGroups('implementation', 'self-review', {});
    assert.deepStrictEqual(g, [['implementation.md']]);
  });
});

describe('lean track end-to-end happy path (source-artifact semantics)', () => {
  // Walk every lean-track transition and assert that:
  //   (a) without source artifacts → applyTransition fails
  //   (b) with only the source artifacts → applyTransition succeeds
  //       (destination artifacts are NOT pre-created)

  const transitions = [
    {
      from: 'initialized',
      to: 'feasibility',
      sourceArtifacts: [],   // bootstrap — nothing needed
      description: 'initialized → feasibility needs no source artifacts',
    },
    {
      from: 'feasibility',
      to: 'lean-track-check',
      sourceArtifacts: ['feasibility.md'],
      description: 'feasibility → lean-track-check needs feasibility.md',
    },
    {
      from: 'lean-track-check',
      to: 'lean-track-implementation',
      sourceArtifacts: ['lean-track-check.md'],
      setPipelineTrack: 'lean',
      description: 'lean-track-check → lean-track-implementation needs lean-track-check.md only',
    },
    {
      from: 'lean-track-implementation',
      to: 'validation',
      sourceArtifacts: ['implementation.md', 'review-pass.md'],
      description: 'lean-track-implementation → validation needs implementation.md + review verdict',
    },
    {
      from: 'validation',
      to: 'pr-creation',
      sourceArtifacts: ['validation-results.md'],
      description: 'validation → pr-creation needs validation-results.md (not cicd.md/pr-link.txt)',
    },
    {
      from: 'pr-creation',
      to: 'approval-wait',
      sourceArtifacts: ['cicd.md', 'pr-link.txt'],
      description: 'pr-creation → approval-wait needs cicd.md + pr-link.txt',
    },
    {
      from: 'approval-wait',
      to: 'completed',
      sourceArtifacts: ['cicd.md', 'pr-link.txt'],
      description: 'approval-wait → completed needs cicd.md + pr-link.txt',
    },
  ];

  for (const tc of transitions) {
    it(tc.description, () => {
      const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-e2e-'));
      const wd = path.join(tmp2, 'w');
      fs.mkdirSync(wd, { recursive: true });
      try {
        const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
        tpl.work_id = 'e2e-lean';
        tpl.task = 'lean e2e';
        tpl.pipeline = tpl.pipeline || {};
        tpl.pipeline.track = 'lean';
        tpl.current_state = tc.from;
        tpl.budget = tpl.budget || {};
        tpl.budget.budget_remaining = 30;
        tpl.budget.cost_used = 0;
        fs.writeFileSync(path.join(wd, 'state.json'), JSON.stringify(tpl, null, 2));

        // Write only the source artifacts (no destination artifacts pre-created).
        for (const art of tc.sourceArtifacts) {
          writeFile(path.join(wd, art), `# ${art}\n`);
        }

        const opts = { workDir: wd, pluginRoot, to: tc.to, actor: 'e2e-test', skipMuscleMemory: true };
        if (tc.setPipelineTrack) opts.setPipelineTrack = tc.setPipelineTrack;

        const r = applyTransition(opts);
        assert.strictEqual(r.ok, true, `${tc.from} → ${tc.to} failed: ${r.message || JSON.stringify(r)}`);

        const loaded = loadWorkItem(wd, pluginRoot);
        assert.strictEqual(loaded.state.current_state, tc.to);
      } finally {
        fs.rmSync(tmp2, { recursive: true, force: true });
      }
    });
  }
});
