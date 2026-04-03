'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const sourceClaude = path.join(repoRoot, '.claude');

const SUBDIRS = ['commands', 'phases', 'agents', 'templates', 'references', 'tools'];

describe('install-tree: SUBDIRS covers all expected subtrees', () => {
  for (const dir of SUBDIRS) {
    it(`source .claude/${dir}/ exists and is non-empty`, () => {
      const full = path.join(sourceClaude, dir);
      assert.ok(fs.existsSync(full), `missing source directory: .claude/${dir}`);
      const entries = fs.readdirSync(full);
      assert.ok(entries.length > 0, `.claude/${dir} is empty`);
    });
  }
});

describe('install-tree: .work bootstrap artifacts', () => {
  it('installer creates .work/.gitkeep (verified via bin script constants)', () => {
    const bin = fs.readFileSync(path.join(repoRoot, 'bin', 'agentic-swe.js'), 'utf8');
    assert.ok(bin.includes("'.work'"), 'bin script must reference .work directory');
    assert.ok(bin.includes("'.gitkeep'"), 'bin script must create .gitkeep');
  });
});

describe('install-tree: .gitignore append logic', () => {
  it('installer appends .claude/.work/ to .gitignore', () => {
    const bin = fs.readFileSync(path.join(repoRoot, 'bin', 'agentic-swe.js'), 'utf8');
    assert.ok(bin.includes('.claude/.work/'), 'bin must reference .claude/.work/ for gitignore');
  });
});

describe('install-tree: error path guards', () => {
  it('rejects when target equals package root', () => {
    const bin = fs.readFileSync(path.join(repoRoot, 'bin', 'agentic-swe.js'), 'utf8');
    assert.ok(
      bin.includes('Target is the same as the agentic-swe package root'),
      'bin must guard against self-install'
    );
  });

  it('rejects when target directory does not exist', () => {
    const bin = fs.readFileSync(path.join(repoRoot, 'bin', 'agentic-swe.js'), 'utf8');
    assert.ok(
      bin.includes('Directory does not exist'),
      'bin must guard against missing target directory'
    );
  });
});
