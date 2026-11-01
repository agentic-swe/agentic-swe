'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  applyTransition,
  loadWorkItem,
  recordReview,
  recordSpawn,
  validateTransition,
} = require('../scripts/lib/work-engine/engine.cjs');
const { readJournal, verifyWorkJournal } = require('../scripts/lib/work-engine/journal.cjs');
const { decideReview, reviewSummary, validateFindings } = require('../scripts/lib/work-engine/reviews.cjs');

const pluginRoot = path.join(__dirname, '..');
const workEngine = path.join(pluginRoot, 'scripts', 'work-engine.cjs');

function workItem(stateName) {
  const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
  tpl.work_id = 'review-gate';
  tpl.task = 'test';
  tpl.pipeline.track = 'rigorous';
  tpl.current_state = stateName;
  tpl.budget.budget_remaining = 30;
  tpl.budget.cost_used = 0;
  tpl.history = [];
  return tpl;
}

const high = (id, extra = {}) => ({ id, severity: 'high', summary: `issue ${id}`, evidence_refs: ['src/a.js:10'], ...extra });

describe('independent review', () => {
  let tmp;
  let workDir;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ae016-'));
    workDir = path.join(tmp, '.worklogs', 'review-gate');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(workItem('self-review'), null, 2));
    for (const f of ['implementation.md', 'self-review.md', 'review-pass.md']) fs.writeFileSync(path.join(workDir, f), `# ${f}\n`);
    fs.writeFileSync(path.join(workDir, 'audit.log'), '# audit\n');
    const entered = applyTransition({ workDir, pluginRoot, to: 'code-review', actor: 'test', skipMuscleMemory: true });
    assert.equal(entered.ok, true, entered.message);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const review = (fields) => recordReview({ workDir, pluginRoot, reviewer: 'security-reviewer', model: 'model-b', actor: 'hypervisor', ...fields });
  const gate = () => {
    const { state } = loadWorkItem(workDir, pluginRoot);
    return validateTransition({ workDir, pluginRoot, state, from: 'code-review', to: 'permissions-check' });
  };

  it('journals review.recorded with reviewer, model, run id, findings and verdict', () => {
    const r = review({ runId: 'run-1', verdict: 'approved', findings: [{ id: 'f1', severity: 'low', summary: 'naming', evidence_refs: ['src/a.js:3'] }] });
    assert.equal(r.ok, true, r.message);
    const chain = readJournal(workDir);
    const last = chain.events[chain.events.length - 1];
    assert.equal(last.type, 'review.recorded');
    const rec = last.state.reviews[0];
    assert.equal(rec.reviewer, 'security-reviewer');
    assert.equal(rec.model, 'model-b');
    assert.equal(rec.run_id, 'run-1');
    assert.equal(rec.verdict, 'approved');
    assert.equal(rec.phase, 'code-review');
    assert.deepEqual(rec.findings, [{ id: 'f1', severity: 'low', summary: 'naming', evidence_refs: ['src/a.js:3'], resolved: false }]);
    assert.equal(verifyWorkJournal(workDir).ok, true);
    assert.match(fs.readFileSync(path.join(workDir, 'audit.log'), 'utf8'), /action=review_recorded phase=code-review reviewer=security-reviewer model=model-b run=run-1 verdict=approved findings=1 blocking=0/);
  });

  it('rejects leaving code-review with no recorded review', () => {
    const g = gate();
    assert.equal(g.ok, false);
    assert.equal(g.code, 'REVIEW_MISSING');
  });

  it('passes with an approved review and no blocking findings', () => {
    review({ runId: 'run-1', verdict: 'approved', findings: [{ id: 'm', severity: 'medium', summary: 'x', evidence_refs: ['a'] }] });
    assert.equal(gate().ok, true, gate().message);
  });

  for (const severity of ['high', 'critical']) {
    it(`blocks on an unresolved ${severity} finding until a later run marks it resolved`, () => {
      review({ runId: 'run-1', verdict: 'approved', findings: [high('h1', { severity })] });
      const g = gate();
      assert.equal(g.code, 'REVIEW_BLOCKING_FINDINGS');
      assert.match(g.message, new RegExp(`security-reviewer/h1 \\[${severity}\\]`));
      review({ runId: 'run-2', verdict: 'approved', findings: [high('h1', { severity, resolved: true })] });
      assert.equal(gate().ok, true);
    });
  }

  it('a failed run is not a pass; a later successful run from the same reviewer replaces it', () => {
    const f = review({ runId: 'run-1', failed: true, error: 'timed out after 600s' });
    assert.equal(f.ok, true, f.message);
    assert.equal(readJournal(workDir).events.at(-1).type, 'review.failed');
    const g = gate();
    assert.equal(g.code, 'REVIEW_FAILED');
    assert.match(g.message, /timed out/);
    review({ runId: 'run-2', verdict: 'approved' });
    assert.equal(gate().ok, true);
  });

  it('one reviewer failing blocks even when another approved', () => {
    review({ runId: 'run-1', verdict: 'approved' });
    review({ runId: 'run-2', reviewer: 'architecture-reviewer', failed: true, error: 'crashed' });
    assert.equal(gate().code, 'REVIEW_FAILED');
  });

  it('a spawned reviewer with no result counts as missing', () => {
    review({ runId: 'run-1', verdict: 'approved' });
    assert.equal(recordSpawn({ workDir, pluginRoot, role: 'agentic-swe:performance-engineer' }).ok, true);
    const g = gate();
    assert.equal(g.code, 'REVIEW_MISSING');
    assert.match(g.message, /performance-engineer/);
    review({ runId: 'run-2', reviewer: 'performance-engineer', verdict: 'approved' });
    assert.equal(gate().ok, true);
  });

  it('a rejecting or escalating latest verdict blocks', () => {
    review({ runId: 'run-1', verdict: 'rejected' });
    assert.equal(gate().code, 'REVIEW_REJECTED');
    review({ runId: 'run-2', verdict: 'escalated' });
    assert.equal(gate().code, 'REVIEW_REJECTED');
  });

  it('reviews from an earlier code-review round do not count', () => {
    review({ runId: 'run-1', verdict: 'approved' });
    assert.equal(gate().ok, true);
    for (const to of ['implementation', 'self-review', 'code-review']) {
      const t = applyTransition({ workDir, pluginRoot, to, actor: 'test', skipMuscleMemory: true });
      assert.equal(t.ok, true, t.message);
    }
    assert.equal(gate().code, 'REVIEW_MISSING');
  });

  it('does not gate the other code-review exits', () => {
    const { state } = loadWorkItem(workDir, pluginRoot);
    assert.equal(validateTransition({ workDir, pluginRoot, state, from: 'code-review', to: 'implementation' }).ok, true);
  });

  it('applyTransition refuses code-review → permissions-check and leaves state unchanged', () => {
    review({ runId: 'run-1', verdict: 'approved', findings: [high('h1')] });
    const t = applyTransition({ workDir, pluginRoot, to: 'permissions-check', actor: 'test', skipMuscleMemory: true });
    assert.equal(t.ok, false);
    assert.equal(t.code, 'REVIEW_BLOCKING_FINDINGS');
    assert.equal(loadWorkItem(workDir, pluginRoot).state.current_state, 'code-review');
  });

  describe('independence', () => {
    it('flags a reviewer on the implementer model as same_model', () => {
      assert.equal(recordSpawn({ workDir, pluginRoot, role: 'developer-agent', model: 'Model-A' }).ok, true);
      assert.equal(review({ runId: 'run-1', model: 'model-a', verdict: 'approved' }).review.independence, 'same_model');
      assert.equal(review({ runId: 'run-2', reviewer: 'architecture-reviewer', model: 'model-b', verdict: 'approved' }).review.independence, 'independent');
      const s = reviewSummary(loadWorkItem(workDir, pluginRoot).state);
      assert.deepEqual(s.same_model, [{ reviewer: 'security-reviewer', run_id: 'run-1', model: 'model-a' }]);
      assert.match(fs.readFileSync(path.join(workDir, 'audit.log'), 'utf8'), /run=run-1 .* independence=same_model/);
    });

    it('is unknown without an implementer model, and --implementer-model overrides the spawn', () => {
      assert.equal(review({ runId: 'run-1', verdict: 'approved' }).review.independence, 'unknown');
      recordSpawn({ workDir, pluginRoot, role: 'developer-agent', model: 'model-a' });
      const r = review({ runId: 'run-2', model: 'model-a', implementerModel: 'model-c', verdict: 'approved' }).review;
      assert.equal(r.implementer_model, 'model-c');
      assert.equal(r.independence, 'independent');
    });

    it('work status surfaces reviews and same-model flags', () => {
      recordSpawn({ workDir, pluginRoot, role: 'developer-agent', model: 'model-a' });
      review({ runId: 'run-1', model: 'model-a', verdict: 'approved', findings: [high('h1')] });
      const r = spawnSync(process.execPath, [workEngine, 'status', '--work-dir', workDir], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Reviews: 1 recorded, 0 failed, 1 unresolved high\/critical/);
      assert.match(r.stdout, /Same-model reviews: security-reviewer \(model-a\)/);
      const j = JSON.parse(spawnSync(process.execPath, [workEngine, 'status', '--work-dir', workDir, '--json'], { encoding: 'utf8' }).stdout);
      assert.equal(j.reviews.unresolved_blocking[0].id, 'h1');
    });
  });

  describe('input validation', () => {
    it('rejects bad findings, duplicate run ids, failed without error, and bad verdicts', () => {
      assert.match(review({ runId: 'r1', verdict: 'approved', findings: [{ id: 'a', severity: 'high', summary: 's' }] }).message, /evidence_refs/);
      assert.match(review({ runId: 'r1', verdict: 'approved', findings: [{ id: 'a', severity: 'urgent', summary: 's', evidence_refs: ['x'] }] }).message, /severity/);
      assert.equal(review({ runId: 'r1', verdict: 'lgtm' }).code, 'REVIEW_INVALID');
      assert.equal(review({ runId: 'r1', failed: true }).code, 'REVIEW_INVALID');
      assert.equal(review({ runId: 'r1', model: '', verdict: 'approved' }).code, 'REVIEW_INVALID');
      assert.equal(review({ runId: 'r1', verdict: 'approved' }).ok, true);
      assert.equal(review({ runId: 'r1', verdict: 'approved' }).code, 'REVIEW_DUPLICATE_RUN');
      assert.equal(loadWorkItem(workDir, pluginRoot).state.reviews.length, 1);
    });

    it('validateFindings catches duplicate ids and non-boolean resolved', () => {
      const p = validateFindings([high('a'), high('a'), high('b', { resolved: 'yes' })]);
      assert.ok(p.some((m) => /duplicated/.test(m)));
      assert.ok(p.some((m) => /resolved must be a boolean/.test(m)));
      assert.deepEqual(validateFindings({}), ['findings must be a JSON array']);
    });

    it('decideReview is pure', () => {
      const state = workItem('code-review');
      const before = JSON.stringify(state);
      const r = decideReview(state, { reviewer: 'x', model: 'm', runId: '1', verdict: 'approved', now: 'now' });
      assert.equal(r.ok, true);
      assert.equal(JSON.stringify(state), before);
      assert.equal(r.next.reviews.length, 1);
    });
  });

  it('record-review CLI reads a findings file and prints the record', () => {
    const file = path.join(tmp, 'findings.json');
    fs.writeFileSync(file, JSON.stringify([high('h1')]));
    const r = spawnSync(process.execPath, [
      workEngine, 'record-review', '--work-dir', workDir, '--reviewer', 'adversarial-reviewer', '--model', 'model-b',
      '--run-id', 'cli-1', '--verdict', 'approved', '--findings', file, '--json',
    ], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const out = JSON.parse(r.stdout);
    assert.equal(out.review.findings[0].severity, 'high');
    const failed = spawnSync(process.execPath, [
      workEngine, 'record-review', '--work-dir', workDir, '--reviewer', 'adversarial-reviewer', '--model', 'model-b',
      '--run-id', 'cli-2', '--failed', '--error', 'no output', '--json',
    ], { encoding: 'utf8' });
    assert.equal(failed.status, 0, failed.stderr || failed.stdout);
    assert.equal(JSON.parse(failed.stdout).review.type, 'review.failed');
    const bad = spawnSync(process.execPath, [workEngine, 'record-review', '--work-dir', workDir, '--reviewer', 'x', '--model', 'm', '--run-id', 'cli-3', '--verdict', 'approved', '--findings', path.join(tmp, 'nope.json'), '--json'], { encoding: 'utf8' });
    assert.equal(bad.status, 2);
  });
});
