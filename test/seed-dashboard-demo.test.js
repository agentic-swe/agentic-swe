'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateWorkItemSchemaAtRoot } = require('../scripts/lib/work-engine/validate-schema.cjs');

const root = path.join(__dirname, '..');
const seedCli = path.join(root, 'scripts', 'seed-dashboard-demo.cjs');

describe('seed-dashboard-demo', () => {
  it('writes two valid work items with --force', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awe-seed-'));
    try {
      const r = spawnSync(process.execPath, [seedCli, '--cwd', tmp, '--force'], { encoding: 'utf8', cwd: root });
      assert.strictEqual(r.status, 0, r.stderr + r.stdout);
      const pluginRoot = root;
      for (const id of ['_demo-active', '_demo-done']) {
        const p = path.join(tmp, '.worklogs', id, 'state.json');
        assert.ok(fs.existsSync(p), p);
        const state = JSON.parse(fs.readFileSync(p, 'utf8'));
        const v = validateWorkItemSchemaAtRoot(state, pluginRoot);
        assert.strictEqual(v.ok, true, JSON.stringify(v.errors));
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
