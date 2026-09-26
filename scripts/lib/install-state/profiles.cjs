'use strict';

const fs = require('fs');
const path = require('path');

function portableEntries() {
  return require('../../setup.cjs').PORTABLE_ENTRIES;
}

const MINIMAL_ENTRIES = [
  'CLAUDE.md',
  'AGENTS.md',
  'state-machine.json',
  'commands',
  'phases',
  'scripts/work-engine.cjs',
  'schemas',
  'templates',
  'hooks/session-start',
];

const KNOWN_PROFILES = new Set(['core', 'minimal', 'full']);

function loadCapabilities(packRoot) {
  const file = path.join(packRoot, 'config', 'capability-profiles.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function allCapabilityPaths(capabilities) {
  const paths = [];
  for (const capabilityPaths of Object.values(capabilities)) {
    paths.push(...capabilityPaths);
  }
  return paths;
}

function resolveProfile({ profile, withCapabilities = [], packRoot }) {
  if (!KNOWN_PROFILES.has(profile)) {
    throw new Error('unknown profile');
  }

  const needsCapabilityConfig = profile === 'full' || withCapabilities.length > 0;
  const capabilities = needsCapabilityConfig ? loadCapabilities(packRoot) : null;
  if (capabilities) {
    for (const capability of withCapabilities) {
      if (!Object.prototype.hasOwnProperty.call(capabilities, capability)) {
        throw new Error('unknown capability');
      }
    }
  }

  let entries;
  if (profile === 'core') {
    entries = [...portableEntries()];
  } else if (profile === 'minimal') {
    entries = [...MINIMAL_ENTRIES];
  } else {
    entries = [...portableEntries(), ...allCapabilityPaths(capabilities)];
  }

  if (capabilities && withCapabilities.length) {
    for (const capability of withCapabilities) {
      entries.push(...capabilities[capability]);
    }
  }

  return entries;
}

module.exports = {
  resolveProfile,
  MINIMAL_ENTRIES,
};
