'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { PORTABLE_ENTRIES } = require('../scripts/setup.cjs');
const { resolveProfile } = require('../scripts/lib/install-state/profiles.cjs');

test('core matches the shipped portable pack and minimal omits Jev', () => {
  const core = resolveProfile({ profile: 'core', withCapabilities: [], packRoot: process.cwd() });
  assert.deepEqual(core, PORTABLE_ENTRIES);
  const minimal = resolveProfile({ profile: 'minimal', withCapabilities: [], packRoot: process.cwd() });
  assert.equal(minimal.includes('config/jev.default.json'), false);
  assert.equal(minimal.includes('scripts/lib/jev'), false);
});

test('unknown capability is rejected before a file list is returned', () => {
  assert.throws(() => resolveProfile({
    profile: 'core', withCapabilities: ['not-a-capability'], packRoot: process.cwd(),
  }), /unknown capability/);
});
