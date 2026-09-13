'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.join(__dirname, '..');
const catalogIndex = path.join(repoRoot, 'scripts', 'catalog-index.cjs');
const catalogRoute = path.join(repoRoot, 'scripts', 'catalog-route.cjs');

describe('catalog semantic index + route', () => {
  it('builds index and returns semantic results (test embeddings)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catsem-'));
    const subRoot = path.join(tmp, 'agents', 'subagents', 'demo');
    fs.mkdirSync(subRoot, { recursive: true });
    const mk = (base, words) =>
      fs.writeFileSync(
        path.join(subRoot, `${base}.md`),
        `---
name: ${base}
description: "Use when you need ${words}."
tools: Read
model: balanced
---
x`
      );
    mk('alpha', 'alpha widgets kubernetes');
    mk('beta', 'beta gizmos terraform');

    const rIdx = spawnSync(process.execPath, [catalogIndex, '--project-root', tmp, '--plugin-root', repoRoot], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, AGENTIC_SWE_SUBAGENTS_DIR: path.join(tmp, 'agents', 'subagents') },
    });
    assert.strictEqual(rIdx.status, 0, rIdx.stderr + rIdx.stdout);

    const rRoute = spawnSync(
      process.execPath,
      [
        catalogRoute,
        'alpha widgets kubernetes',
        '--mode',
        'semantic',
        '--k',
        '2',
        '--json',
        '--project-root',
        tmp,
        '--plugin-root',
        repoRoot,
      ],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, AGENTIC_SWE_SUBAGENTS_DIR: path.join(tmp, 'agents', 'subagents') },
      }
    );
    assert.strictEqual(rRoute.status, 0, rRoute.stderr);
    const data = JSON.parse(rRoute.stdout);
    assert.strictEqual(data.mode, 'semantic');
    assert.strictEqual(data.results[0].id, 'demo/alpha');
  });
});
