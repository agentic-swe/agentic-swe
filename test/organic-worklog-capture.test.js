'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { captureOrganicWorklogs } = require('../scripts/lib/descent/capture-organic-worklogs.cjs');
const { runEvolveCycle } = require('../scripts/evolve-cycle.cjs');
const { runDescentOnImplementationEntry } = require('../scripts/lib/descent/implementation-descent.cjs');
const { discoverActiveWorkDir } = require('../scripts/lib/work-engine/discover-workdir.cjs');

const pluginRoot = path.resolve(__dirname, '..');

function writeOrganicWorkItem(projectRoot) {
  const workDir = path.join(projectRoot, '.worklogs', 'feat-retry');
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
  fs.mkdirSync(path.join(projectRoot, 'test'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'src', 'retry.js'), 'module.exports = 1;\n');
  fs.writeFileSync(
    path.join(projectRoot, 'test', 'retry.test.js'),
    `'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
test('retry', () => assert.equal(require('../src/retry.js'), 1));
`
  );
  fs.writeFileSync(
    path.join(workDir, 'state.json'),
    JSON.stringify({
      work_id: 'feat-retry',
      current_state: 'completed',
      metrics: { verify_command: 'npm test', tests_passed: true },
      history: [
        { actor: 'composer', from: 'implementation', to: 'validation', reason: 'ready' },
        { actor: 'composer', from: 'validation', to: 'pr-creation', reason: 'approved' },
        { actor: 'user', from: 'pr-creation', to: 'completed', reason: 'merged' },
      ],
    })
  );
  fs.writeFileSync(
    path.join(workDir, 'implementation.md'),
    '# Implementation\n\n1. `src/retry.js`\n2. `test/retry.test.js`\n\n```bash\nnpm test\n```\n'
  );
  fs.writeFileSync(
    path.join(workDir, 'validation-results.md'),
    '# Validation\n\nclassification: `approved`\n\n```bash\nnpm test\n```\n'
  );
  return workDir;
}

describe('organic worklog capture', () => {
  it('captures numbered declared files with isolated node --test verify', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'org-cap-'));
    writeOrganicWorkItem(tmp);
    const r = captureOrganicWorklogs({
      projectRoot: tmp,
      pluginRoot,
      includeFixtures: false,
      preferIsolatedTest: true,
    });
    assert.equal(r.captured, 1, JSON.stringify(r.captures));
    const cap = r.captures[0];
    assert.equal(cap.ok, true);
    assert.ok(cap.files.includes('src/retry.js'));
    assert.ok(cap.files.includes('test/retry.test.js'));
    assert.equal(cap.verifyCommand, 'node --test test/retry.test.js');
    assert.ok(cap.read_actions >= 2);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('evolve-cycle captures organic /work into the project store and memory', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'org-ev-'));
    writeOrganicWorkItem(tmp);
    const mine = await runEvolveCycle({ projectRoot: tmp, pluginRoot, limit: 4 });
    assert.equal(mine.ok, true);
    assert.ok(mine.organic_captured >= 1, JSON.stringify(mine));
    assert.ok(mine.organic_memory_items >= 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('follow-up implementation skip_llm overlaps organic-worklog isolated verify', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'org-skip-'));
    writeOrganicWorkItem(tmp);
    captureOrganicWorklogs({
      projectRoot: tmp,
      pluginRoot,
      includeFixtures: false,
      preferIsolatedTest: true,
    });
    const workDir = path.join(tmp, '.worklogs', 'w-followup');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'state.json'),
      JSON.stringify({
        work_id: 'w-followup',
        current_state: 'test-strategy',
        metrics: { verify_command: 'npm test' },
        budget: {},
      })
    );
    fs.writeFileSync(path.join(workDir, 'design.md'), '# Design\n\n- `src/retry.js`\n\n```bash\nnpm test\n```\n');
    const r = await runDescentOnImplementationEntry({ workDir, pluginRoot, projectRoot: tmp });
    assert.equal(r.skip_llm_exploration, true, JSON.stringify({ tier: r.tier, overlap: r.overlap_source, reason: r.descent?.reason }));
    assert.equal(r.overlap_source, 'organic-worklog');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('discoverActiveWorkDir binds completed /work matching git branch suffix', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'org-br-'));
    writeOrganicWorkItem(tmp);
    const init = spawnSync('git', ['init'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(init.status, 0, init.stderr);
    fs.writeFileSync(path.join(tmp, '.git', 'HEAD'), 'ref: refs/heads/work/feat-retry\n');
    const picked = discoverActiveWorkDir(tmp);
    assert.equal(path.basename(picked || ''), 'feat-retry');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
