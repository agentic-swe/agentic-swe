'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');

describe('F-M2-04 portfolio progress', () => {
  it('flushes portfolio-bench progress and finishes with an empty store', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-progress-'));
    const storeRoot = path.join(tmp, 'store');
    const outPath = path.join(tmp, 'portfolio.json');
    fs.mkdirSync(path.join(storeRoot, '.agentic-swe'), { recursive: true });
    fs.writeFileSync(
      path.join(storeRoot, '.agentic-swe', 'procedures.json'),
      JSON.stringify({ procedures: [] }, null, 2)
    );

    // Bound well under Measurement's patience; empty store should finish in seconds.
    const r = spawnSync(
      process.execPath,
      [
        path.join(root, 'scripts/bench/run-portfolio.cjs'),
        '--store-root',
        storeRoot,
        '--out',
        outPath,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 180_000,
        killSignal: 'SIGKILL',
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR || os.tmpdir(),
          LANG: process.env.LANG || 'C',
          CI: '1',
        },
      }
    );

    const err = r.stderr || '';
    assert.equal(r.error && r.error.code, undefined, `spawn error: ${r.error && r.error.message}`);
    assert.match(err, /portfolio-bench: starting/, `expected flushed start progress, stderr=${err.slice(0, 500)}`);
    assert.match(err, /portfolio-bench: holdout /, `expected per-task progress, stderr=${err.slice(0, 800)}`);
    assert.equal(r.status, 0, `portfolio exit ${r.status}\n${err}\n${r.stdout || ''}`);
    assert.ok(fs.existsSync(outPath), 'portfolio out file missing');
    const payload = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    assert.equal(payload.ok, true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
