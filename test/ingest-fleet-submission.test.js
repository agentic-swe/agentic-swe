'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { emptyTierTotals } = require('../scripts/lib/bench/tier-totals.cjs');
const {
  ingestFleetSubmission,
  listArchivedSubmissions,
  summarizeFleetSubmissions,
  findArchivesByGitOrigin,
} = require('../scripts/ingest-fleet-submission.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('ingest-fleet-submission', () => {
  it('archives ready consumer submission and emits team event', async () => {
    const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-ing-'));
    for (const id of ['feat-ing-a', 'feat-ing-b', 'feat-ing-c']) {
      const workDir = path.join(consumer, '.worklogs', id);
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(
        path.join(workDir, 'state.json'),
        JSON.stringify({
          work_id: id,
          current_state: 'completed',
          budget: { tier_totals: emptyTierTotals() },
          history: [
            { actor: 'engineer', from: 'implementation', to: 'validation' },
            { actor: 'user', from: 'pr-creation', to: 'completed' },
          ],
        })
      );
    }
    const subPath = path.join(consumer, 'fleet-submission.json');
    const gen = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts/fleet-submit.cjs'), '--project-root', consumer, '--out', subPath],
      { encoding: 'utf8' }
    );
    assert.equal(gen.status, 0, gen.stderr || gen.stdout);

    const archiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-ing-p-'));
    fs.mkdirSync(path.join(archiveRoot, 'bench', 'results', 'fleet-submissions'), { recursive: true });
    fs.cpSync(path.join(pluginRoot, '.claude-plugin'), path.join(archiveRoot, '.claude-plugin'), { recursive: true });
    fs.mkdirSync(path.join(archiveRoot, 'hooks'), { recursive: true });
    fs.copyFileSync(path.join(pluginRoot, 'hooks/session-stop'), path.join(archiveRoot, 'hooks/session-stop'));
    fs.copyFileSync(path.join(pluginRoot, 'hooks/hooks.json'), path.join(archiveRoot, 'hooks/hooks.json'));
    fs.mkdirSync(path.join(archiveRoot, 'config'), { recursive: true });
    fs.copyFileSync(
      path.join(pluginRoot, 'config/memory.default.json'),
      path.join(archiveRoot, 'config/memory.default.json')
    );

    const r = await ingestFleetSubmission({ submissionPath: subPath, pluginRoot: archiveRoot });
    assert.equal(r.ok, true);
    assert.equal(r.goal_complete, false);
    assert.equal(r.fleet_submissions_archived, 1);
    assert.ok(fs.existsSync(r.archive_path));
    const archived = listArchivedSubmissions(archiveRoot);
    assert.equal(archived.length, 1);
    assert.equal(archived[0].fleet_submission_ready, true);

    fs.rmSync(consumer, { recursive: true, force: true });
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  });

  it('summarizes distinct consumer roots', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-sum-'));
    const dir = path.join(tmp, 'bench', 'results', 'fleet-submissions');
    fs.mkdirSync(dir, { recursive: true });
    for (const root of ['/tmp/a', '/tmp/b']) {
      fs.writeFileSync(
        path.join(dir, `sub-${path.basename(root)}.json`),
        JSON.stringify({ project_root: root, fleet_submission_ready: true })
      );
    }
    const summary = summarizeFleetSubmissions(tmp);
    assert.equal(summary.archived, 2);
    assert.equal(summary.distinct_consumers, 2);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('excludes maintainer_dogfood from fleet-scale summary', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-scale-'));
    const dir = path.join(tmp, 'bench', 'results', 'fleet-submissions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'independent.json'),
      JSON.stringify({ project_root: '/tmp/indep', fleet_evidence_class: 'independent' })
    );
    fs.writeFileSync(
      path.join(dir, 'dogfood.json'),
      JSON.stringify({ project_root: '/tmp/dog', fleet_evidence_class: 'maintainer_dogfood' })
    );
    const all = summarizeFleetSubmissions(tmp);
    const scale = summarizeFleetSubmissions(tmp, { forFleetScale: true });
    assert.equal(all.archived, 2);
    assert.equal(all.distinct_consumers, 2);
    assert.equal(scale.archived_independent, 1);
    assert.equal(scale.distinct_independent_consumers, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects pack-root submissions', async () => {
    const r = await ingestFleetSubmission({
      submissionPath: path.join(pluginRoot, 'package.json'),
      pluginRoot,
    });
    assert.equal(r.ok, false);
  });

  it('findArchivesByGitOrigin normalizes git URLs', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-git-'));
    const dir = path.join(tmp, 'bench', 'results', 'fleet-submissions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'one.json'),
      JSON.stringify({ project_root: '/tmp/x', git: { origin: 'https://github.com/org/repo.git' } })
    );
    const hits = findArchivesByGitOrigin(tmp, 'https://github.com/org/repo');
    assert.equal(hits.length, 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('rejects independent ingest from maintainer_dogfood consumer root', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-dogfood-reject-'));
    const dir = path.join(tmp, 'bench', 'results', 'fleet-submissions');
    fs.mkdirSync(dir, { recursive: true });
    const dogfoodRoot = path.join(tmp, 'consumer-dogfood');
    fs.mkdirSync(dogfoodRoot, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'dogfood.json'),
      JSON.stringify({
        project_root: dogfoodRoot,
        fleet_evidence_class: 'maintainer_dogfood',
        fleet_submission_ready: true,
      })
    );
    const subPath = path.join(tmp, 'independent-attempt.json');
    fs.writeFileSync(
      subPath,
      JSON.stringify({
        project_root: dogfoodRoot,
        fleet_evidence_class: 'independent',
        fleet_submission_ready: true,
        evidence: { submission_readiness: { organic_live: 3, portfolio_multiplier: 0.01 } },
      })
    );
    const r = await ingestFleetSubmission({ submissionPath: subPath, pluginRoot: tmp });
    assert.equal(r.ok, false);
    assert.match(r.error, /maintainer_dogfood/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('dedupes identical submission digest', async () => {
    const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-dup-'));
    for (const id of ['feat-dup-a', 'feat-dup-b', 'feat-dup-c']) {
      const workDir = path.join(consumer, '.worklogs', id);
      fs.mkdirSync(workDir, { recursive: true });
      fs.writeFileSync(
        path.join(workDir, 'state.json'),
        JSON.stringify({
          work_id: id,
          current_state: 'completed',
          budget: { tier_totals: emptyTierTotals() },
          history: [
            { actor: 'engineer', from: 'implementation', to: 'validation' },
            { actor: 'user', from: 'pr-creation', to: 'completed' },
          ],
        })
      );
    }
    const subPath = path.join(consumer, 'fleet-submission.json');
    const gen = spawnSync(
      process.execPath,
      [path.join(pluginRoot, 'scripts/fleet-submit.cjs'), '--project-root', consumer, '--out', subPath],
      { encoding: 'utf8' }
    );
    assert.equal(gen.status, 0, gen.stderr || gen.stdout);

    const archiveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-dup-p-'));
    fs.mkdirSync(path.join(archiveRoot, 'bench', 'results', 'fleet-submissions'), { recursive: true });
    fs.mkdirSync(path.join(archiveRoot, 'hooks'), { recursive: true });
    fs.copyFileSync(path.join(pluginRoot, 'hooks/session-stop'), path.join(archiveRoot, 'hooks/session-stop'));
    fs.copyFileSync(path.join(pluginRoot, 'hooks/hooks.json'), path.join(archiveRoot, 'hooks/hooks.json'));
    fs.mkdirSync(path.join(archiveRoot, 'config'), { recursive: true });
    fs.copyFileSync(
      path.join(pluginRoot, 'config/memory.default.json'),
      path.join(archiveRoot, 'config/memory.default.json')
    );

    const first = await ingestFleetSubmission({ submissionPath: subPath, pluginRoot: archiveRoot });
    const second = await ingestFleetSubmission({ submissionPath: subPath, pluginRoot: archiveRoot });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.duplicate, true);
    assert.equal(listArchivedSubmissions(archiveRoot).length, 1);
    assert.ok(second.team_memory?.ok === true);

    fs.rmSync(consumer, { recursive: true, force: true });
    fs.rmSync(archiveRoot, { recursive: true, force: true });
  });
});

describe('transition tier_totals warning', () => {
  it('warns when validation transition leaves no tier_totals', () => {
    const { applyTransition } = require('../scripts/lib/work-engine/engine.cjs');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'warn-tier-'));
    const workDir = path.join(tmp, '.worklogs', 'w-warn');
    fs.mkdirSync(workDir, { recursive: true });
    const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
    tpl.work_id = 'w-warn';
    tpl.current_state = 'validation';
    tpl.metrics.tests_passed = true;
    fs.writeFileSync(path.join(workDir, 'state.json'), JSON.stringify(tpl));
    fs.writeFileSync(
      path.join(workDir, 'validation-results.md'),
      '# Validation\n\nclassification: `approved`\n\n```bash\nnpm test\n```\n'
    );

    const r = applyTransition({
      workDir,
      pluginRoot,
      from: 'validation',
      to: 'pr-creation',
      actor: 'test',
      skipMuscleMemory: true,
      procedureStoreRoot: tmp,
    });
    assert.equal(r.ok, true);
    assert.ok(r.muscle_memory_warning);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
