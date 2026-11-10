'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { lintLayers } = require('../scripts/layer-lint.cjs');
const { resolveHookPath, runPostTransitionHooks } = require('../scripts/lib/work-engine/post-transition.cjs');

const root = path.join(__dirname, '..');

describe('F-M2-03 ADR-016 layer lint', () => {
  it('passes on the real pack (every lib dir mapped, no upward edges)', () => {
    const result = lintLayers(root);
    assert.equal(result.ok, true, (result.errors || []).join('\n'));
  });

  it('fails when a module is missing from the layer map', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-lint-'));
    fs.mkdirSync(path.join(tmp, 'scripts', 'lib', 'shared'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'scripts', 'lib', 'orphan-mod'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'scripts', 'lib', 'shared', 'x.cjs'), "'use strict';\n");
    fs.writeFileSync(path.join(tmp, 'scripts', 'lib', 'orphan-mod', 'x.cjs'), "'use strict';\n");
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'layers.json'), JSON.stringify({
      layers: { storage: 4 },
      modules: { shared: 'storage' },
      dynamic_allowlist: [],
      forbidden: [],
    }));
    const result = lintLayers(tmp);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('orphan-mod')));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('fails on an upward / forbidden edge', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-up-'));
    fs.mkdirSync(path.join(tmp, 'scripts', 'lib', 'shared'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'scripts', 'lib', 'work-engine'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'scripts', 'lib', 'shared', 'x.cjs'), "'use strict';\nmodule.exports = {};\n");
    fs.writeFileSync(
      path.join(tmp, 'scripts', 'lib', 'shared', 'up.cjs'),
      "'use strict';\nrequire('../work-engine/x.cjs');\n"
    );
    fs.writeFileSync(path.join(tmp, 'scripts', 'lib', 'work-engine', 'x.cjs'), "'use strict';\nmodule.exports = {};\n");
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'layers.json'), JSON.stringify({
      layers: { core: 3, storage: 4 },
      modules: { shared: 'storage', 'work-engine': 'core' },
      dynamic_allowlist: [],
      forbidden: [{ from: 'storage', to: 'core' }],
    }));
    const result = lintLayers(tmp);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /forbidden edge|upward edge/.test(e)), result.errors.join('\n'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('fails on a non-allowlisted dynamic require under scripts/lib', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'layer-dyn-'));
    fs.mkdirSync(path.join(tmp, 'scripts', 'lib', 'shared'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'scripts', 'lib', 'shared', 'dyn.cjs'),
      "'use strict';\nmodule.exports = (p) => require(p);\n"
    );
    fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'config', 'layers.json'), JSON.stringify({
      layers: { storage: 4 },
      modules: { shared: 'storage' },
      dynamic_allowlist: [],
      forbidden: [],
    }));
    const result = lintLayers(tmp);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('non-literal require')), result.errors.join('\n'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('npm run verify invokes layer-lint', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.match(pkg.scripts.verify, /layer-lint\.cjs/);
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'layer-lint.cjs')], {
      cwd: root, encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });
});

describe('F-M2-03 post-transition hook paths', () => {
  it('refuses absolute hook paths unless allowAbsolute is set', () => {
    assert.throws(
      () => resolveHookPath('/tmp/evil.cjs', root),
      (err) => err.code === 'HOOK_PATH_DENIED'
    );
    const abs = resolveHookPath('/tmp/evil.cjs', root, { allowAbsolute: true });
    assert.equal(abs, '/tmp/evil.cjs');
  });

  it('refuses relative hooks outside scripts/lib/post-transition/', () => {
    assert.throws(
      () => resolveHookPath('scripts/lib/descent/capture-procedure.cjs', root),
      (err) => err.code === 'HOOK_PATH_DENIED'
    );
  });

  it('does not load an absolute hook when allowAbsolute is false', () => {
    const r = runPostTransitionHooks({
      pluginRoot: root,
      hooks: ['/tmp/does-not-matter.cjs'],
      ctx: { workDir: root, pluginRoot: root, from: 'a', to: 'b' },
    });
    assert.equal(r.ran.length, 0);
    assert.equal(r.errors[0].code, 'HOOK_PATH_DENIED');
  });
});
