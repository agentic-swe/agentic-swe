'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const claudeMdPath = path.join(__dirname, '..', 'CLAUDE.md');
const phasesDir = path.join(__dirname, '..', 'phases');

const PHASE_FILE_EXCEPTIONS = {
  initialized: 'initialized.md',
  completed: 'merge-completion.md',
};

function extractTransitionBlock(body) {
  const lines = body.split('\n');
  let inBlock = false;
  const states = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '```' && inBlock) break;
    if (inBlock && line.includes('->')) {
      const parts = line.split('->').map((s) => s.trim());
      states.add(parts[0]);
      for (const dest of parts[1].split('|').map((s) => s.trim())) {
        states.add(dest);
      }
    }
    if (line.trim() === '```' && !inBlock && i + 1 < lines.length && lines[i + 1]?.includes('->')) {
      inBlock = true;
    }
  }
  return states;
}

function extractArtifactTableStates(body) {
  const states = new Set();
  const lines = body.split('\n');
  let inTable = false;
  for (const line of lines) {
    if (line.includes('Required Artifacts')) {
      inTable = true;
      continue;
    }
    if (inTable && line.startsWith('|')) {
      const match = line.match(/\|\s*`([^`]+)`\s*\|/);
      if (match) states.add(match[1]);
    }
    if (inTable && !line.startsWith('|') && line.trim() !== '') inTable = false;
  }
  return states;
}

describe('claude-md-consistency: state machine transitions match phase files', () => {
  const body = fs.readFileSync(claudeMdPath, 'utf8');
  const transitionStates = extractTransitionBlock(body);

  it('extracted at least 10 states from transition block', () => {
    assert.ok(transitionStates.size >= 10, `only found ${transitionStates.size} states`);
  });

  for (const state of transitionStates) {
    it(`state "${state}" has a corresponding phase file or known exception`, () => {
      const phaseFile = PHASE_FILE_EXCEPTIONS[state] || `${state}.md`;
      const full = path.join(phasesDir, phaseFile);
      assert.ok(fs.existsSync(full), `no phase file for state "${state}" (expected ${phaseFile})`);
    });
  }
});

describe('claude-md-consistency: artifact table states are in transition block', () => {
  const body = fs.readFileSync(claudeMdPath, 'utf8');
  const transitionStates = extractTransitionBlock(body);
  const artifactStates = extractArtifactTableStates(body);

  it('extracted artifact table states', () => {
    assert.ok(artifactStates.size >= 5, `only found ${artifactStates.size} artifact table states`);
  });

  for (const state of artifactStates) {
    it(`artifact table state "${state}" appears in transition block`, () => {
      assert.ok(
        transitionStates.has(state),
        `"${state}" in artifact table but not in transitions`
      );
    });
  }
});

describe('claude-md-consistency: core mirror and deferred reference', () => {
  const claudeBody = fs.readFileSync(claudeMdPath, 'utf8');
  const agentsPath = path.join(__dirname, '..', 'AGENTS.md');
  const deferredPath = path.join(__dirname, '..', 'references', 'deferred', 'hypervisor-deferred.md');

  it('CLAUDE.md references deferred hypervisor policy', () => {
    assert.match(claudeBody, /hypervisor-deferred\.md/);
  });

  it('CLAUDE.md contains cache boundary marker', () => {
    assert.match(claudeBody, /CACHE_BOUNDARY/);
  });

  it('deferred reference file exists', () => {
    assert.ok(fs.existsSync(deferredPath), 'references/deferred/hypervisor-deferred.md missing');
  });

  it('AGENTS.md mirrors transition block from CLAUDE.md', () => {
    const agentsBody = fs.readFileSync(agentsPath, 'utf8');
    assert.match(agentsBody, /initialized -> feasibility/);
    assert.match(agentsBody, /Required Artifacts by State/);
  });

  it('core CLAUDE.md is smaller than full backup', () => {
    const backup = path.join(__dirname, '..', 'references', 'deferred', 'hypervisor-deferred-full-backup.md');
    if (!fs.existsSync(backup)) return;
    const coreLen = fs.statSync(claudeMdPath).size;
    const fullLen = fs.statSync(backup).size;
    assert.ok(coreLen < fullLen * 0.5, `core should be <50% of backup (${coreLen} vs ${fullLen})`);
  });
});
