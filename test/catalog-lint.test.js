'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const lintScript = path.join(root, 'scripts', 'catalog-lint.cjs');

describe('catalog-lint', () => {
  it('passes on bundled agents/subagents', () => {
    const r = spawnSync(process.execPath, [lintScript], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, r.stderr || r.stdout);
  });

  it('fails on duplicate agent names', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catlint-'));
    const body = `---
name: dup-agent
description: "Use when you need duplicate-name test one."
tools: Read
model: balanced
provenance:
  origin: first-party
  license: MIT
  authors: "Test"
---
`;
    for (const c of ['c1', 'c2']) {
      const cat = path.join(dir, c);
      fs.mkdirSync(cat, { recursive: true });
      fs.writeFileSync(path.join(cat, 'dup-agent.md'), body, 'utf8');
    }

    const r = spawnSync(process.execPath, [lintScript], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, AGENTIC_SWE_SUBAGENTS_DIR: dir },
    });
    assert.ok(r.status !== 0, 'expected non-zero exit');
    assert.match(r.stderr + r.stdout, /duplicate agent name/i);
  });

  it('fails when provenance.license is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catlint-prov-'));
    const cat = path.join(dir, 'c1');
    fs.mkdirSync(cat, { recursive: true });
    fs.writeFileSync(
      path.join(cat, 'no-prov.md'),
      `---
name: no-prov
description: "Use when testing missing provenance license."
tools: Read
model: balanced
---
`,
      'utf8'
    );
    const r = spawnSync(process.execPath, [lintScript], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, AGENTIC_SWE_SUBAGENTS_DIR: dir },
    });
    assert.ok(r.status !== 0, 'expected non-zero exit');
    assert.match(r.stderr + r.stdout, /provenance\.license/i);
  });
});
