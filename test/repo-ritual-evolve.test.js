'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mineRepoRituals } = require('../scripts/lib/descent/mine-repo-rituals.cjs');

const pluginRoot = path.resolve(__dirname, '..');

describe('mine repo rituals', () => {
  it('records package.json test script as unevaluated muscle memory on the project', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-ritual-'));
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ name: 'ritual-fix', scripts: { test: 'npm run never-eval-this-full-suite' } })
    );
    const r = mineRepoRituals({ projectRoot: tmp, pluginRoot, limit: 4 });
    assert.equal(r.ok, true);
    assert.equal(r.procedures, 1);
    const store = JSON.parse(fs.readFileSync(path.join(tmp, '.agentic-swe', 'procedures.json'), 'utf8'));
    assert.equal(store.procedures[0].eval_status, 'unevaluated');
    assert.match(store.procedures[0].procedure.verify[0].command, /never-eval-this-full-suite/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('session-capture hook stdin', () => {
  it('reads transcript_path from hook JSON on stdin', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-stdin-'));
    const tx = path.join(tmp, 'hook.jsonl');
    fs.writeFileSync(
      tx,
      JSON.stringify({
        role: 'user',
        message: { content: 'Decision: run node test/ok.test.js after every muscle-memory change.' },
      }) + '\n'
    );
    const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts/session-capture.cjs'), '--json', '--no-evolve'], {
      encoding: 'utf8',
      cwd: tmp,
      input: JSON.stringify({ cwd: tmp, transcript_path: tx }),
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const payload = JSON.parse(r.stdout.trim());
    assert.equal(payload.ok, true);
    assert.ok(payload.chunks >= 1);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
