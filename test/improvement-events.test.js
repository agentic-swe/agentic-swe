'use strict';

/**
 * AE-035a — schema tests for improvement.proposed / improvement.evaluated,
 * work template, receipt fold, and no merge/deploy entry points.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { validateEvent } = require('../scripts/lib/shared/journal-registry.cjs');
const { commitState, appendEvent, readJournal } = require('../scripts/lib/shared/journal.cjs');
const { extractReceipt } = require('../scripts/lib/receipt/extract.cjs');
const { formatMarkdown } = require('../scripts/lib/receipt/format.cjs');
const improvement = require('../scripts/lib/improvement/index.cjs');

const FIXTURES = path.join(__dirname, 'fixtures', 'improvement');
const IMPROVEMENT_DIR = path.join(__dirname, '..', 'scripts', 'lib', 'improvement');

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function tmpWork(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `awe-${name}-`));
  const workDir = path.join(root, '.worklogs', name);
  fs.mkdirSync(workDir, { recursive: true });
  return { root, workDir };
}

function seedWork(workDir) {
  const state = {
    work_id: path.basename(workDir),
    task: 'self-improvement fixture',
    current_state: 'initialized',
    created_at: '2026-11-13T00:00:00.000Z',
    updated_at: '2026-11-13T00:00:00.000Z',
    history: [],
    pipeline: { track: 'rigorous' },
    budget: { cost_used: 0, budget_remaining: 1 },
    mode: 'self-improvement',
  };
  const projected = commitState(workDir, state, { type: 'init', at: state.created_at });
  fs.writeFileSync(path.join(workDir, 'state.json'), `${JSON.stringify(projected, null, 2)}\n`);
  return projected;
}

describe('AE-035a improvement.proposed / improvement.evaluated schemas', () => {
  it('accepts valid improvement.proposed payload (schema)', () => {
    const payload = loadFixture('valid-proposed.json');
    const result = validateEvent('improvement.proposed', payload);
    assert.equal(result.ok, true, result.message);
  });

  it('accepts valid improvement.evaluated payload (schema)', () => {
    const payload = loadFixture('valid-evaluated.json');
    const result = validateEvent('improvement.evaluated', payload);
    assert.equal(result.ok, true, result.message);
  });

  it('rejects improvement.proposed missing baseline_ref', () => {
    const payload = loadFixture('broken-proposed-missing-baseline.json');
    const result = validateEvent('improvement.proposed', payload);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'EVENT_INVALID');
    assert.match(result.message, /baseline_ref|required/i);
  });

  it('rejects improvement.evaluated with invalid outcome', () => {
    const payload = loadFixture('broken-evaluated-bad-outcome.json');
    const result = validateEvent('improvement.evaluated', payload);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'EVENT_INVALID');
  });

  it('appendEvent journals both types with contiguous seq', () => {
    const { root, workDir } = tmpWork('ae035a-append');
    seedWork(workDir);
    const proposed = improvement.proposeImprovement(workDir, loadFixture('valid-proposed.json'));
    const evaluated = improvement.evaluateImprovement(workDir, loadFixture('valid-evaluated.json'));
    assert.equal(proposed.type, 'improvement.proposed');
    assert.equal(evaluated.type, 'improvement.evaluated');
    assert.ok(evaluated.seq > proposed.seq);
    const chain = readJournal(workDir);
    assert.equal(chain.ok, true);
    assert.ok(chain.events.some((e) => e.type === 'improvement.proposed'));
    assert.ok(chain.events.some((e) => e.type === 'improvement.evaluated'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects bad payload via proposeImprovement without appending', () => {
    const { root, workDir } = tmpWork('ae035a-bad');
    seedWork(workDir);
    const before = fs.readFileSync(path.join(workDir, 'journal.jsonl'), 'utf8');
    assert.throws(
      () => improvement.proposeImprovement(workDir, loadFixture('broken-proposed-missing-baseline.json')),
      (err) => err && err.code === 'EVENT_INVALID'
    );
    assert.equal(fs.readFileSync(path.join(workDir, 'journal.jsonl'), 'utf8'), before);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('AE-035a self-improvement work template', () => {
  it('loads template with mode self-improvement and draft-only flags', () => {
    const tmpl = improvement.loadSelfImprovementStateTemplate();
    assert.equal(tmpl.mode, 'self-improvement');
    assert.equal(tmpl.pipeline.track, 'rigorous');
    assert.equal(tmpl.improvement.draft_pr_only, true);
    assert.equal(tmpl.improvement.merge_authorized, false);
    assert.equal(tmpl.improvement.deploy_authorized, false);
    assert.equal(tmpl.improvement.independent_review_required, true);
    assert.ok(Object.prototype.hasOwnProperty.call(tmpl.artifacts, 'improvement-proposal'));
  });

  it('buildSelfImprovementWorkItem fills ids and keeps governance flags', () => {
    const state = improvement.buildSelfImprovementWorkItem({
      work_id: 'imp-work-1',
      task: 'propose compare gate',
      baseline_ref: 'sha:abc',
      proposal_id: 'imp-001',
      created_at: '2026-11-13T12:00:00.000Z',
    });
    assert.equal(state.work_id, 'imp-work-1');
    assert.equal(state.mode, 'self-improvement');
    assert.equal(state.improvement.proposal_id, 'imp-001');
    assert.equal(state.improvement.baseline_ref, 'sha:abc');
    assert.equal(state.improvement.merge_authorized, false);
    assert.equal(state.improvement.deploy_authorized, false);
    assert.equal(state.pipeline.track, 'rigorous');
  });

  it('proposal markdown template states draft PR only / no self-merge', () => {
    const { body } = improvement.loadImprovementProposalTemplate();
    assert.match(body, /Draft PR only/i);
    assert.match(body, /No self-authorized merge/i);
    assert.match(body, /improvement\.proposed/);
    assert.match(body, /improvement\.evaluated/);
  });
});

describe('AE-035a receipt fold includes improvement events', () => {
  it('extractReceipt folds proposed and evaluated with source_seq', () => {
    const { root, workDir } = tmpWork('ae035a-receipt');
    seedWork(workDir);
    improvement.proposeImprovement(workDir, loadFixture('valid-proposed.json'));
    improvement.evaluateImprovement(workDir, {
      ...loadFixture('valid-evaluated.json'),
      outcome: 'regress',
      regression: true,
    });
    const receipt = extractReceipt(workDir);
    assert.equal(receipt.integrity, 'verified');
    assert.equal(receipt.improvementsProposed.length, 1);
    assert.equal(receipt.improvementsEvaluated.length, 1);
    assert.equal(receipt.improvementsProposed[0].proposal_id, 'imp-001');
    assert.ok(Number.isInteger(receipt.improvementsProposed[0].source_seq));
    assert.ok(Number.isInteger(receipt.improvementsEvaluated[0].source_seq));
    assert.equal(receipt.improvementsEvaluated[0].regression, true);
    assert.equal(receipt.improvementsEvaluated[0].outcome, 'regress');

    const md = formatMarkdown(receipt);
    assert.match(md, /Self-improvement/);
    assert.match(md, /imp-001/);
    assert.match(md, /outcome=regress/);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('AE-035a no merge/deploy entry point in new code', () => {
  it('module exports exclude merge/deploy/publish names', () => {
    const exported = Object.keys(improvement);
    for (const name of improvement.FORBIDDEN_ENTRY_POINTS) {
      assert.ok(!exported.includes(name), `must not export ${name}`);
    }
    assert.ok(typeof improvement.proposeImprovement === 'function');
    assert.ok(typeof improvement.evaluateImprovement === 'function');
    assert.equal(typeof improvement.merge, 'undefined');
    assert.equal(typeof improvement.deploy, 'undefined');
    assert.equal(typeof improvement.publish, 'undefined');
  });

  it('improvement lib source has no merge/deploy/publish entry-point definitions', () => {
    const files = fs.readdirSync(IMPROVEMENT_DIR).filter((f) => f.endsWith('.cjs') || f.endsWith('.js'));
    assert.ok(files.length >= 1);
    // AE-035b may name deny-catalog tool paths (e.g. github.merge) but must not
    // define success-path entry points named merge/deploy/publish/selfMerge.
    const banned = [
      /\bfunction\s+(merge|deploy|publish|selfMerge)\b/,
      /\b(merge|deploy|publish|selfMerge)\s*[:=]\s*(async\s*)?function\b/,
      /\b(merge|deploy|publish|selfMerge)\s*[:=]\s*\(/,
      /\b(mergePullRequest|npmPublish|bypassReview)\s*[:=]/,
    ];
    for (const file of files) {
      const src = fs.readFileSync(path.join(IMPROVEMENT_DIR, file), 'utf8');
      for (const re of banned) {
        assert.equal(re.test(src), false, `${file} matched banned pattern ${re}`);
      }
    }
    assert.equal(typeof improvement.mergeImprovementPullRequest, 'function');
    assert.equal(improvement.mergeImprovementPullRequest({}).ok, false);
    assert.equal(improvement.mergeImprovementPullRequest({}).code, 'SELF_MERGE_DENIED');
  });

  it('direct appendEvent of unregistered merge type stays EVENT_INVALID', () => {
    const { root, workDir } = tmpWork('ae035a-nomerg');
    seedWork(workDir);
    assert.throws(
      () => appendEvent(workDir, { type: 'improvement.merged', payload: { proposal_id: 'x' } }),
      (err) => err && err.code === 'EVENT_INVALID'
    );
    assert.throws(
      () => appendEvent(workDir, { type: 'improvement.deployed', payload: { proposal_id: 'x' } }),
      (err) => err && err.code === 'EVENT_INVALID'
    );
    fs.rmSync(root, { recursive: true, force: true });
  });
});
