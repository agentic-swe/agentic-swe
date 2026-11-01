'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { applyTransition, loadWorkItem, recordSpawn, validateTransition } = require('../scripts/lib/work-engine/engine.cjs');
const { loadMergedBudgetThresholds } = require('../scripts/lib/work-engine/budget-config.cjs');
const { recordTrackWaiver } = require('../scripts/lib/work-engine/track-guard.cjs');
const { checkTrackRules } = require('../scripts/lib/policy/merge.cjs');

const pluginRoot = path.join(__dirname, '..');
const workEngine = path.join(pluginRoot, 'scripts', 'work-engine.cjs');
const identity = { actor: 'user:tester@example.com', name: 'Tester', email: 'tester@example.com', os_user: 'tester' };

delete process.env.AGENTIC_SWE_POLICY;
delete process.env.AGENTIC_SWE_BUDGET_THRESHOLDS;

let repo;

function writePolicy(policy) {
  fs.mkdirSync(path.join(repo, '.agentic-swe'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.agentic-swe', 'policy.json'), JSON.stringify(policy));
}

function workItem(stateName, track, { files = [], pipeline = {} } = {}) {
  const dir = path.join(repo, '.worklogs', 'w1');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tpl = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'templates', 'state.json'), 'utf8'));
  tpl.work_id = 'w1';
  tpl.task = 'policy enforcement';
  tpl.current_state = stateName;
  tpl.pipeline = { ...tpl.pipeline, track, ...pipeline };
  tpl.budget.budget_remaining = 30;
  tpl.budget.cost_used = 0;
  tpl.budget.cost_budget_usd = 10;
  tpl.history = [];
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(tpl, null, 2));
  for (const f of files) fs.writeFileSync(path.join(dir, f), `# ${f}\n`);
  return dir;
}

function go(dir, to, extra = {}) {
  return applyTransition({ workDir: dir, pluginRoot, to, actor: 'test', skipMuscleMemory: true, ...extra });
}

function git(...args) {
  const r = spawnSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd: repo, encoding: 'utf8' }
  );
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim();
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-enforce-'));
});

describe('policy required_artifacts', () => {
  it('requires the extra file before leaving the state', () => {
    writePolicy({ required_artifacts: { feasibility: ['risk-register.md'] } });
    const dir = workItem('feasibility', 'rigorous', { files: ['feasibility.md'] });
    const blocked = go(dir, 'lean-track-check');
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.code, 'ARTIFACTS_INCOMPLETE');
    assert.deepStrictEqual(blocked.missing, ['risk-register.md']);

    fs.writeFileSync(path.join(dir, 'risk-register.md'), '# risks\n');
    const r = go(dir, 'lean-track-check');
    assert.strictEqual(r.ok, true, r.message);
  });

  it('accepts either file of an a|b entry', () => {
    writePolicy({ required_artifacts: { feasibility: ['perf.md|perf-waiver.md'] } });
    const dir = workItem('feasibility', 'rigorous', { files: ['feasibility.md', 'perf-waiver.md'] });
    const r = go(dir, 'lean-track-check');
    assert.strictEqual(r.ok, true, r.message);
  });

  it('rejects an entry that leaves the work dir', () => {
    writePolicy({ required_artifacts: { feasibility: ['../../outside.md'] } });
    const dir = workItem('feasibility', 'rigorous', { files: ['feasibility.md'] });
    const r = go(dir, 'lean-track-check');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'POLICY_INVALID');
  });

  it('does not apply to other states', () => {
    writePolicy({ required_artifacts: { design: ['threat-model.md'] } });
    const dir = workItem('feasibility', 'rigorous', { files: ['feasibility.md'] });
    assert.strictEqual(go(dir, 'lean-track-check').ok, true);
  });
});

describe('policy track_rules', () => {
  const rules = {
    track_rules: [
      { pattern: 'src/auth/**', minimum_track: 'rigorous', reason: 'auth' },
      { pattern: '*.sql', minimum_track: 'standard' },
    ],
  };

  it('rejects a lean track for a path that needs rigorous', () => {
    writePolicy(rules);
    const dir = workItem('lean-track-check', 'lean', { files: ['lean-track-check.md'] });
    const r = go(dir, 'lean-track-implementation', { setPipelineTrack: 'lean', changedPaths: ['src/auth/login.js'] });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'TRACK_POLICY');
    assert.strictEqual(r.minimum_track, 'rigorous');
    assert.match(r.message, /src\/auth\/\*\* \(auth\)/);
    assert.strictEqual(loadWorkItem(dir, pluginRoot).state.current_state, 'lean-track-check');
  });

  it('applies the default lean track when no track is passed', () => {
    writePolicy(rules);
    const dir = workItem('lean-track-check', 'lean', { files: ['lean-track-check.md'] });
    const r = go(dir, 'lean-track-implementation', { changedPaths: ['src/auth/login.js'] });
    assert.strictEqual(r.code, 'TRACK_POLICY');
  });

  it('matches a slash-free pattern at any depth', () => {
    writePolicy(rules);
    assert.strictEqual(checkTrackRules(['db/migrations/001.sql'], rules), 'standard');
    const dir = workItem('lean-track-check', 'lean', { files: ['lean-track-check.md'] });
    const r = go(dir, 'lean-track-implementation', { setPipelineTrack: 'lean', changedPaths: ['db/migrations/001.sql'] });
    assert.strictEqual(r.code, 'TRACK_POLICY');
    assert.strictEqual(r.minimum_track, 'standard');
  });

  it('allows a track that meets the minimum and records the declared paths', () => {
    writePolicy(rules);
    const dir = workItem('lean-track-check', 'rigorous', { files: ['lean-track-check.md'] });
    const r = go(dir, 'design', { setPipelineTrack: 'rigorous', changedPaths: ['src/auth/login.js'] });
    assert.strictEqual(r.ok, true, r.message);
    assert.deepStrictEqual(r.state.pipeline.changed_paths, ['src/auth/login.js']);
  });

  it('allows lean when no changed path matches', () => {
    writePolicy(rules);
    const dir = workItem('lean-track-check', 'lean', { files: ['lean-track-check.md'] });
    const r = go(dir, 'lean-track-implementation', { setPipelineTrack: 'lean', changedPaths: ['docs/guide.md'] });
    assert.strictEqual(r.ok, true, r.message);
  });

  it('requires declared paths before a lean or standard track', () => {
    writePolicy(rules);
    const dir = workItem('lean-track-check', 'standard', { files: ['lean-track-check.md'] });
    const r = go(dir, 'design', { setPipelineTrack: 'standard' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'POLICY_PATHS_REQUIRED');
    assert.strictEqual(go(dir, 'design', { setPipelineTrack: 'rigorous' }).ok, true);
  });

  it('plan-transition reports the same verdict without writing', () => {
    writePolicy(rules);
    const dir = workItem('lean-track-check', 'lean', { files: ['lean-track-check.md'] });
    const v = validateTransition({
      workDir: dir,
      pluginRoot,
      state: loadWorkItem(dir, pluginRoot).state,
      from: 'lean-track-check',
      to: 'lean-track-implementation',
      setPipelineTrack: 'lean',
      changedPaths: ['src/auth/a.js'],
    });
    assert.strictEqual(v.code, 'TRACK_POLICY');
  });

  it('blocks a waived downgrade below the policy minimum', () => {
    writePolicy(rules);
    const dir = workItem('implementation', 'rigorous', {
      files: ['implementation.md'],
      pipeline: { changed_paths: ['src/auth/login.js'] },
    });
    assert.strictEqual(recordTrackWaiver({ workDir: dir, pluginRoot, reason: 'founder', identity }).ok, true);
    const r = go(dir, 'self-review', { setPipelineTrack: 'standard' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'TRACK_POLICY');
  });

  it('records base_sha and counts files changed since it', () => {
    writePolicy(rules);
    git('init', '-q');
    fs.writeFileSync(path.join(repo, 'README.md'), 'x\n');
    git('add', 'README.md');
    git('commit', '-q', '-m', 'init');
    const head = git('rev-parse', 'HEAD');

    const dir = workItem('lean-track-check', 'standard', { files: ['lean-track-check.md'] });
    const r = go(dir, 'design', { setPipelineTrack: 'standard', changedPaths: ['docs/guide.md'] });
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(r.state.pipeline.base_sha, head);

    const { collectChangedPaths } = require('../scripts/lib/policy/enforce.cjs');
    fs.mkdirSync(path.join(repo, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'src', 'auth', 'new.js'), 'x\n');
    fs.writeFileSync(path.join(repo, 'README.md'), 'changed\n');
    const paths = collectChangedPaths(loadWorkItem(dir, pluginRoot).state, repo);
    assert.strictEqual(paths.ok, true);
    assert.ok(paths.paths.includes('src/auth/new.js'), paths.paths.join(','));
    assert.ok(paths.paths.includes('README.md'));
    assert.ok(paths.paths.includes('docs/guide.md'));
    assert.ok(!paths.paths.some((p) => p.startsWith('.worklogs/')));
  });

  it('lists changed paths relative to a project nested in a git repo', () => {
    git('init', '-q');
    const project = path.join(repo, 'pkg');
    fs.mkdirSync(path.join(project, 'src', 'auth'), { recursive: true });
    fs.writeFileSync(path.join(project, 'src', 'auth', 'a.js'), 'x\n');
    git('add', '.');
    git('commit', '-q', '-m', 'init');
    const head = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(project, 'src', 'auth', 'a.js'), 'changed\n');
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'x\n');
    const { collectChangedPaths } = require('../scripts/lib/policy/enforce.cjs');
    const r = collectChangedPaths({ pipeline: { base_sha: head } }, project);
    assert.deepStrictEqual(r.paths, ['src/auth/a.js']);
  });

  it('fails closed when base_sha is recorded but git cannot diff', () => {
    writePolicy(rules);
    const dir = workItem('implementation', 'rigorous', {
      files: ['implementation.md'],
      pipeline: { base_sha: 'deadbeef' },
    });
    assert.strictEqual(recordTrackWaiver({ workDir: dir, pluginRoot, reason: 'founder', identity }).ok, true);
    const r = go(dir, 'self-review', { setPipelineTrack: 'standard' });
    assert.strictEqual(r.code, 'POLICY_PATHS_UNAVAILABLE');
  });
});

describe('policy mandatory_subagents', () => {
  const rule = { pattern: 'src/payments/**', subagent: 'quality-security/security-auditor.md', phase: 'code-review' };

  it('blocks leaving the phase until the spawn is recorded in it', () => {
    writePolicy({ mandatory_subagents: [rule] });
    const dir = workItem('code-review', 'rigorous', {
      files: ['review-pass.md'],
      pipeline: { changed_paths: ['src/payments/charge.js'] },
    });
    const blocked = go(dir, 'permissions-check');
    assert.strictEqual(blocked.ok, false);
    assert.strictEqual(blocked.code, 'MANDATORY_SUBAGENT_MISSING');
    assert.match(blocked.message, /security-auditor\.md for src\/payments\/\*\* in code-review/);

    assert.strictEqual(recordSpawn({ workDir: dir, pluginRoot, role: 'security-auditor', actor: 'test' }).ok, true);
    const r = go(dir, 'permissions-check');
    assert.strictEqual(r.ok, true, r.message);
  });

  it('does not count a spawn recorded in another phase at the phase exit', () => {
    writePolicy({ mandatory_subagents: [rule] });
    const dir = workItem('self-review', 'rigorous', {
      files: ['self-review.md', 'review-pass.md'],
      pipeline: { changed_paths: ['src/payments/charge.js'] },
    });
    assert.strictEqual(recordSpawn({ workDir: dir, pluginRoot, role: 'security-auditor', actor: 'test' }).ok, true);
    assert.strictEqual(go(dir, 'code-review').ok, true);
    const r = go(dir, 'permissions-check');
    assert.strictEqual(r.code, 'MANDATORY_SUBAGENT_MISSING');
  });

  it('checks every rule before pr-creation, even when the track skipped its phase', () => {
    writePolicy({ mandatory_subagents: [rule] });
    const dir = workItem('validation', 'standard', {
      files: ['validation-results.md'],
      pipeline: { changed_paths: ['src/payments/charge.js'] },
    });
    const blocked = go(dir, 'pr-creation');
    assert.strictEqual(blocked.code, 'MANDATORY_SUBAGENT_MISSING');
    assert.strictEqual(recordSpawn({ workDir: dir, pluginRoot, role: 'security-auditor', actor: 'test' }).ok, true);
    const r = go(dir, 'pr-creation');
    assert.strictEqual(r.ok, true, r.message);
  });

  it('ignores rules whose pattern no changed path matches', () => {
    writePolicy({ mandatory_subagents: [rule] });
    const dir = workItem('code-review', 'rigorous', {
      files: ['review-pass.md'],
      pipeline: { changed_paths: ['docs/guide.md'] },
    });
    assert.strictEqual(go(dir, 'permissions-check').ok, true);
  });
});

describe('policy budget_overrides', () => {
  it('replaces every track ceiling in merged thresholds', () => {
    writePolicy({ budget_overrides: { max_cost_usd: 1.5, max_iterations: 4, max_doubt_cycles: 9 } });
    const merged = loadMergedBudgetThresholds(pluginRoot, repo);
    for (const t of ['lean', 'standard', 'rigorous']) {
      assert.strictEqual(merged.tracks[t].cost_budget_usd, 1.5);
      assert.strictEqual(merged.tracks[t].iteration_budget, 4);
    }
    const plain = loadMergedBudgetThresholds(pluginRoot, fs.mkdtempSync(path.join(os.tmpdir(), 'no-policy-')));
    assert.strictEqual(plain.tracks.lean.cost_budget_usd, 2.5);
  });

  it('wins over .agentic-swe/budget-thresholds.json', () => {
    writePolicy({ budget_overrides: { max_cost_usd: 1.5 } });
    fs.writeFileSync(
      path.join(repo, '.agentic-swe', 'budget-thresholds.json'),
      JSON.stringify({ tracks: { standard: { cost_budget_usd: 50 } } })
    );
    assert.strictEqual(loadMergedBudgetThresholds(pluginRoot, repo).tracks.standard.cost_budget_usd, 1.5);
  });

  it('sets the work item budget when the track is chosen', () => {
    writePolicy({ budget_overrides: { max_cost_usd: 1.5, max_iterations: 4 } });
    const dir = workItem('lean-track-check', 'standard', { files: ['lean-track-check.md'] });
    const r = go(dir, 'design', { setPipelineTrack: 'standard' });
    assert.strictEqual(r.ok, true, r.message);
    assert.strictEqual(r.state.budget.cost_budget_usd, 1.5);
    assert.strictEqual(r.state.budget.iteration_budget, 4);
  });

  it('applies at work init', () => {
    writePolicy({ budget_overrides: { max_cost_usd: 0.75 } });
    const r = spawnSync(process.execPath, [workEngine, 'init', '--id', 'w2', '--work-root', repo, '--json'], {
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const st = JSON.parse(fs.readFileSync(path.join(repo, '.worklogs', 'w2', 'state.json'), 'utf8'));
    assert.strictEqual(st.budget.cost_budget_usd, 0.75);
  });
});

describe('policy loading at transitions', () => {
  it('fails a transition when the repo policy is unreadable', () => {
    fs.mkdirSync(path.join(repo, '.agentic-swe'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.agentic-swe', 'policy.json'), '{not json');
    const dir = workItem('feasibility', 'lean', { files: ['feasibility.md'] });
    const r = go(dir, 'lean-track-check');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'POLICY_INVALID');
  });

  it('fails a transition when the repo policy violates the schema', () => {
    writePolicy({ track_rules: [{ pattern: 'src/**', minimum_track: 'extreme' }] });
    const dir = workItem('feasibility', 'lean', { files: ['feasibility.md'] });
    assert.strictEqual(go(dir, 'lean-track-check').code, 'POLICY_INVALID');
  });

  it('CLI transition --changed-paths stores the paths', () => {
    writePolicy({ track_rules: [{ pattern: 'src/auth/**', minimum_track: 'rigorous' }] });
    const dir = workItem('lean-track-check', 'lean', { files: ['lean-track-check.md'] });
    const r = spawnSync(
      process.execPath,
      [workEngine, 'transition', '--work-dir', dir, '--to', 'lean-track-implementation', '--actor', 'test',
        '--set-pipeline-track', 'lean', '--changed-paths', 'docs/a.md, docs/b.md', '--skip-muscle-memory', '--json'],
      { encoding: 'utf8' }
    );
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    assert.deepStrictEqual(loadWorkItem(dir, pluginRoot).state.pipeline.changed_paths, ['docs/a.md', 'docs/b.md']);

    const blocked = spawnSync(
      process.execPath,
      [workEngine, 'plan-transition', '--work-dir', workItem('lean-track-check', 'lean', { files: ['lean-track-check.md'] }),
        '--to', 'lean-track-implementation', '--set-pipeline-track', 'lean', '--changed-paths', 'src/auth/x.js', '--json'],
      { encoding: 'utf8' }
    );
    assert.strictEqual(blocked.status, 1);
    assert.strictEqual(JSON.parse(blocked.stdout).code, 'TRACK_POLICY');
  });
});
