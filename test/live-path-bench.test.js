'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const pluginRoot = path.resolve(__dirname, '..');

describe('isolated live-path bench', () => {
  it('dogfoods applyTransition in tmp and does not write pack-root .worklogs', () => {
    const before = fs.existsSync(path.join(pluginRoot, '.worklogs'))
      ? fs.readdirSync(path.join(pluginRoot, '.worklogs'))
      : [];
    const out = path.join(os.tmpdir(), `live-path-test-${Date.now()}.json`);
    const r = spawnSync(process.execPath, [path.join(pluginRoot, 'scripts/bench/run-live-path.cjs'), '--out', out], {
      cwd: pluginRoot,
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const data = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(data.ok, true);
    assert.ok(data.live_work_items >= 1);
    assert.match(String(data.measurement_contract), /not pack-root/);
    const after = fs.existsSync(path.join(pluginRoot, '.worklogs'))
      ? fs.readdirSync(path.join(pluginRoot, '.worklogs'))
      : [];
    assert.deepEqual(after, before);
    fs.rmSync(out, { force: true });
  });
});
