'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { writeCompactArtifact } = require('../scripts/lib/memory/memory-compact.cjs');

describe('memory-compact', () => {
  let tmp;
  let workDir;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-cmp-'));
    fs.mkdirSync(path.join(tmp, '.worklogs', 'wi1'), { recursive: true });
    workDir = path.join(tmp, '.worklogs', 'wi1');
    fs.writeFileSync(path.join(workDir, 'progress.md'), '# P\n\nHello progress content.\n', 'utf8');
    fs.writeFileSync(path.join(workDir, 'design.md'), '# D\n\nDesign notes here.\n', 'utf8');
  });

  after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('writes context-compact.md with capped sections', () => {
    const r = writeCompactArtifact({ workDirAbs: workDir, pluginRoot: root });
    assert.ok(fs.existsSync(r.outputPath), r.outputPath);
    const s = fs.readFileSync(r.outputPath, 'utf8');
    assert.ok(s.includes('progress.md'));
    assert.ok(s.includes('Hello progress'));
    assert.ok(r.filesUsed.includes('progress.md'));
  });
});
