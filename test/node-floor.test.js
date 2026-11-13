const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  meetsNodeFloor,
  parseNodeVersion,
  NODE_FLOOR_LABEL,
} = require('../scripts/lib/shared/node-version.cjs');

const ROOT = path.join(__dirname, '..');
const FLOOR = 22;
/** Root pack floor for unflagged node:sqlite (ADR-004b / PD-48 C1). */
const ROOT_ENGINES_NODE = '>=22.13';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('node floor — 22.12 rejected by pure version compare', () => {
  assert.equal(meetsNodeFloor('22.12.0'), false);
  assert.equal(meetsNodeFloor('22.12.99'), false);
  assert.equal(meetsNodeFloor('v22.12.0'), false);
});

test('node floor — 22.13 accepted by pure version compare', () => {
  assert.equal(meetsNodeFloor('22.13.0'), true);
  assert.equal(meetsNodeFloor('22.13.1'), true);
  assert.equal(meetsNodeFloor('v22.13.0'), true);
  assert.equal(meetsNodeFloor('23.0.0'), true);
  assert.equal(meetsNodeFloor('21.99.0'), false);
  assert.deepEqual(parseNodeVersion('22.13.0'), { major: 22, minor: 13, patch: 0 });
  assert.equal(NODE_FLOOR_LABEL, '22.13');
});

test('node floor — package manifests and lockfiles declare >=22', () => {
  assert.strictEqual(JSON.parse(read('package.json')).engines.node, ROOT_ENGINES_NODE, 'package.json');
  assert.strictEqual(
    JSON.parse(read('agents/plugin-runtime/brainstorm-server/package.json')).engines.node,
    `>=${FLOOR}`,
    'agents/plugin-runtime/brainstorm-server/package.json'
  );
  assert.strictEqual(
    JSON.parse(read('package-lock.json')).packages[''].engines.node,
    ROOT_ENGINES_NODE,
    'package-lock.json'
  );
  assert.strictEqual(
    JSON.parse(read('agents/plugin-runtime/brainstorm-server/package-lock.json')).packages[''].engines.node,
    `>=${FLOOR}`,
    'agents/plugin-runtime/brainstorm-server/package-lock.json'
  );
});

test('node floor — CI matrix tests only supported lines, starting at the floor', () => {
  const m = read('.github/workflows/ci.yml').match(/node-version:\s*\[([^\]]*)\]/);
  assert.ok(m, 'ci.yml must declare a node-version matrix');
  const versions = m[1].split(',').map((v) => Number(v.trim()));
  assert.ok(versions.length > 0);
  assert.strictEqual(Math.min(...versions), FLOOR, `matrix ${versions} must start at ${FLOOR}`);
});

test('node floor — every workflow setup-node pins a version at or above the floor', () => {
  const dir = path.join(ROOT, '.github', 'workflows');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.yml'))) {
    for (const m of read(path.join('.github', 'workflows', f)).matchAll(/node-version:\s*'(\d+)'/g)) {
      assert.ok(Number(m[1]) >= FLOOR, `${f} uses node ${m[1]}`);
    }
  }
});

test('node floor — installers and doctor enforce the 22.13 patch floor', () => {
  const sh = read('install.sh');
  assert.match(sh, /a>22\|\|\(a===22&&b>=13\)/);
  assert.match(sh, /Node\.js 22\.13 or newer/);
  assert.doesNotMatch(sh, /Node\.js (18|20|22) or newer/);
  const ps = read('install.ps1');
  assert.match(ps, /a>22\|\|\(a===22&&b>=13\)/);
  assert.match(ps, /Node\.js 22\.13 or newer/);
  assert.doesNotMatch(ps, /Node\.js (18|20|22) or newer/);
  const doctor = read('scripts/doctor.cjs');
  assert.match(doctor, /meetsNodeFloor\(process\.versions\.node\)/);
  assert.match(doctor, /shared\/node-version\.cjs/);
  assert.doesNotMatch(doctor, /split\('\.'\)\[0\]\) >= 22,/);
});
