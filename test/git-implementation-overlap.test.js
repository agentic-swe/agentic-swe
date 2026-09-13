'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mineGitProcedures } = require('../scripts/lib/descent/mine-git-procedures.cjs');
const { runDescentOnImplementationEntry } = require('../scripts/lib/descent/implementation-descent.cjs');
const { runDescentOnValidationApproval } = require('../scripts/lib/descent/validation-descent.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('git overlap implementation descent', () => {
  it('skips LLM when design lists source files but a different verify than git-mined tests', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-ov-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'test'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'hit.js'), 'module.exports = 1;\n');
    fs.writeFileSync(
      path.join(tmp, 'test', 'hit.test.js'),
      `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
test('hit', () => assert.equal(require('../src/hit.js'), 1));
`
    );
    spawnSync('git', ['init'], { cwd: tmp, encoding: 'utf8' });
    spawnSync('git', ['add', '.'], { cwd: tmp, encoding: 'utf8' });
    const commit = spawnSync(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'add hit'],
      { cwd: tmp, encoding: 'utf8' }
    );
    assert.equal(commit.status, 0, commit.stderr);
    const mined = mineGitProcedures({ projectRoot: tmp, pluginRoot, maxCommits: 5, limit: 4 });
    assert.ok(mined.procedures >= 1);

    const workDir = path.join(tmp, '.worklogs', 'w-ov');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({
        work_id: 'w-ov',
        current_state: 'test-strategy',
        metrics: { verify_command: 'npm test' },
        budget: { budget_remaining: 20 },
      })
    );
    fs.writeFileSync(
      path.join(workDir, 'design.md'),
      '# Design\n\n- `src/hit.js`\n\n```bash\nnpm test\n```\n'
    );

    const r = await runDescentOnImplementationEntry({ workDir, pluginRoot, projectRoot: tmp });
    assert.equal(r.skip_llm_exploration, true, JSON.stringify({ tier: r.tier, overlap: r.overlap_source, reason: r.descent?.reason }));
    assert.equal(r.overlap_source, 'git-history');
    assert.match(r.verifyCommand, /node --test/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('records L0/L1 at validation using declared files + git overlap, not work_id as the only file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-val-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'test'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'hit.js'), 'module.exports = 1;\n');
    fs.writeFileSync(
      path.join(tmp, 'test', 'hit.test.js'),
      `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
test('hit', () => assert.equal(require('../src/hit.js'), 1));
`
    );
    spawnSync('git', ['init'], { cwd: tmp, encoding: 'utf8' });
    spawnSync('git', ['add', '.'], { cwd: tmp, encoding: 'utf8' });
    spawnSync(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'add hit'],
      { cwd: tmp, encoding: 'utf8' }
    );
    mineGitProcedures({ projectRoot: tmp, pluginRoot, maxCommits: 5, limit: 4 });

    const workDir = path.join(tmp, '.worklogs', 'w-val');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({
        work_id: 'w-val',
        current_state: 'validation',
        metrics: { verify_command: 'npm test' },
        budget: {},
      })
    );
    fs.writeFileSync(
      path.join(workDir, 'implementation.md'),
      '# Implementation\n\n- `src/hit.js`\n\n```bash\nnpm test\n```\n'
    );
    fs.writeFileSync(
      path.join(workDir, 'validation-results.md'),
      '# Validation\n\nclassification: `approved`\n\n```bash\nnpm test\n```\n'
    );

    const r = await runDescentOnValidationApproval({ workDir, pluginRoot, projectRoot: tmp });
    assert.equal(r.ok, true, JSON.stringify({ tier: r.tier, overlap: r.overlap_source }));
    assert.equal(r.overlap_source, 'git-history');
    assert.equal(r.tier === 'L0' || r.tier === 'L1', true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('descent-try CLI hits git overlap using design-declared files, not work_id', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-dtry-'));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'test'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'hit.js'), 'module.exports = 1;\n');
    fs.writeFileSync(
      path.join(tmp, 'test', 'hit.test.js'),
      `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
test('hit', () => assert.equal(require('../src/hit.js'), 1));
`
    );
    spawnSync('git', ['init'], { cwd: tmp, encoding: 'utf8' });
    spawnSync('git', ['add', '.'], { cwd: tmp, encoding: 'utf8' });
    spawnSync(
      'git',
      ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', 'commit', '-m', 'add hit'],
      { cwd: tmp, encoding: 'utf8' }
    );
    mineGitProcedures({ projectRoot: tmp, pluginRoot, maxCommits: 5, limit: 4 });
    const workDir = path.join(tmp, '.worklogs', 'w-dtry');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({
        work_id: 'w-dtry',
        current_state: 'implementation',
        metrics: { verify_command: 'npm test' },
        budget: {},
      })
    );
    fs.writeFileSync(path.join(workDir, 'design.md'), '# Design\n\n- `src/hit.js`\n\n```bash\nnpm test\n```\n');
    const cli = spawnSync(
      process.execPath,
      [
        path.join(pluginRoot, 'scripts/descent-try.cjs'),
        '--work-dir',
        workDir,
        '--project-root',
        tmp,
        '--plugin-root',
        pluginRoot,
        '--json',
      ],
      { encoding: 'utf8', cwd: tmp }
    );
    assert.equal(cli.status, 0, cli.stderr + cli.stdout);
    const payload = JSON.parse(cli.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.overlap_source, 'git-history');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('extractDeclaredFiles treats mined-* backticks as file keys', () => {
    const { extractDeclaredFiles } = require('../scripts/lib/scope/diff-scope-check.cjs');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decl-'));
    const md = path.join(tmp, 'implementation.md');
    fs.writeFileSync(md, '# Implementation\n\nHoldout bench task `mined-trivial-pass`.\n');
    const declared = extractDeclaredFiles(md);
    assert.ok(declared.has('mined-trivial-pass'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('extractDeclaredFiles reads numbered backtick paths', () => {
    const { extractDeclaredFiles } = require('../scripts/lib/scope/diff-scope-check.cjs');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'decl-num-'));
    const md = path.join(tmp, 'implementation.md');
    fs.writeFileSync(
      md,
      '# Implementation\n\n1. `scripts/swe-tui-server.cjs` — TUI\n2. `test/swe-tui.test.js`\n'
    );
    const declared = extractDeclaredFiles(md);
    assert.ok(declared.has('scripts/swe-tui-server.cjs'));
    assert.ok(declared.has('test/swe-tui.test.js'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('descent-try --files uses explicit keys instead of work_id basename', () => {
    const { accumulateDeliveredHoldout } = require('../scripts/lib/descent/holdout-capture.cjs');
    accumulateDeliveredHoldout({ pluginRoot, projectRoot: pluginRoot, purge: true });

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'git-files-'));
    const workDir = path.join(tmp, '.worklogs', 'bench-mined-trivial-pass');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({
        work_id: 'bench-mined-trivial-pass',
        current_state: 'validation',
        metrics: { verify_command: 'npm test' },
        budget: {},
      })
    );
    fs.writeFileSync(
      path.join(workDir, 'implementation.md'),
      '# Implementation\n\nHoldout `mined-trivial-pass`.\n'
    );

    const cli = spawnSync(
      process.execPath,
      [
        path.join(pluginRoot, 'scripts/work-engine.cjs'),
        'descent-try',
        '--work-dir',
        workDir,
        '--project-root',
        pluginRoot,
        '--plugin-root',
        pluginRoot,
        '--files',
        'mined-trivial-pass',
        '--verify',
        'npm test',
        '--json',
      ],
      { encoding: 'utf8', cwd: pluginRoot }
    );
    assert.equal(cli.status, 0, cli.stderr + cli.stdout);
    const payload = JSON.parse(cli.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.tier, 'L0');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
