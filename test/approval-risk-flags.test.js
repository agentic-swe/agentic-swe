'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  parseUnifiedDiff,
  computeRiskFlags,
  collectRiskFlags,
} = require('../scripts/lib/approval/risk-flags.cjs');

const fixtures = path.join(__dirname, 'fixtures', 'approval');
const riskyDiff = fs.readFileSync(path.join(fixtures, 'risky.diff'), 'utf8');
const manifests = {
  'package.json': {
    before: fs.readFileSync(path.join(fixtures, 'package.before.json'), 'utf8'),
    after: fs.readFileSync(path.join(fixtures, 'package.after.json'), 'utf8'),
  },
};

function flagsOf(result, kind) {
  return result.flags.filter((f) => f.kind === kind);
}

describe('approval risk flags', () => {
  it('parses files, statuses and mode changes from a unified diff', () => {
    const files = parseUnifiedDiff(riskyDiff);
    assert.deepEqual(
      files.map((f) => f.path),
      [
        'src/auth/session.js',
        '.github/workflows/ci.yml',
        'scripts/deploy.sh',
        'agents/developer-agent.md',
        'package.json',
        'requirements.txt',
        'README.md',
      ]
    );
    const deploy = files.find((f) => f.path === 'scripts/deploy.sh');
    assert.equal(deploy.oldMode, '100644');
    assert.equal(deploy.newMode, '100755');
    const session = files.find((f) => f.path === 'src/auth/session.js');
    assert.equal(session.status, 'modified');
    assert.deepEqual(session.added, ['const SKIP_CHECK = true;', 'module.exports = { TTL, SKIP_CHECK };']);
  });

  it('flags security-sensitive paths', () => {
    const r = computeRiskFlags(parseUnifiedDiff(riskyDiff), { manifests });
    const paths = flagsOf(r, 'security_sensitive_path').map((f) => f.path);
    assert.ok(paths.includes('src/auth/session.js'));
    assert.ok(paths.includes('.github/workflows/ci.yml'));
    assert.ok(!paths.includes('README.md'));
  });

  it('flags new dependencies but not version bumps', () => {
    const r = computeRiskFlags(parseUnifiedDiff(riskyDiff), { manifests });
    const deps = flagsOf(r, 'new_dependency').map((f) => f.detail);
    assert.ok(deps.some((d) => d.includes('left-pad')), JSON.stringify(deps));
    assert.ok(deps.some((d) => d.includes('pyyaml')), JSON.stringify(deps));
    assert.ok(!deps.some((d) => d.includes('ajv')), 'ajv bump must not be flagged');
    assert.ok(!deps.some((d) => d.includes('requests')), 'requests bump must not be flagged');
  });

  it('flags permission changes (exec bit, workflow permissions, agent tools)', () => {
    const r = computeRiskFlags(parseUnifiedDiff(riskyDiff), { manifests });
    const perm = flagsOf(r, 'permission_change').map((f) => f.path);
    assert.ok(perm.includes('scripts/deploy.sh'));
    assert.ok(perm.includes('.github/workflows/ci.yml'));
    assert.ok(perm.includes('agents/developer-agent.md'));
    assert.equal(r.level, 'high');
    assert.equal(r.counts.permission_change, perm.length);
  });

  it('reports level none for a benign diff', () => {
    const benign = riskyDiff.slice(riskyDiff.indexOf('diff --git a/README.md'));
    const r = computeRiskFlags(parseUnifiedDiff(benign));
    assert.equal(r.level, 'none');
    assert.equal(r.flags.length, 0);
  });

  it('treats a newly added package.json as all-new dependencies', () => {
    const diff = [
      'diff --git a/package.json b/package.json',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/package.json',
      '@@ -0,0 +1,3 @@',
      '+{',
      '+  "dependencies": { "express": "^4.0.0" }',
      '+}',
      '',
    ].join('\n');
    const r = computeRiskFlags(parseUnifiedDiff(diff), {
      manifests: { 'package.json': { before: null, after: '{"dependencies":{"express":"^4.0.0"}}' } },
    });
    assert.deepEqual(flagsOf(r, 'new_dependency').map((f) => f.detail), ['express (dependencies)']);
  });

  it('collectRiskFlags reads a real git range', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asi09-git-'));
    const git = (...a) => {
      const r = spawnSync('git', a, { cwd: tmp, encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    try {
      git('init', '-q');
      git('config', 'user.email', 't@example.com');
      git('config', 'user.name', 'T');
      fs.copyFileSync(path.join(fixtures, 'package.before.json'), path.join(tmp, 'package.json'));
      git('add', '.');
      git('commit', '-qm', 'base');
      const base = git('rev-parse', 'HEAD');
      fs.copyFileSync(path.join(fixtures, 'package.after.json'), path.join(tmp, 'package.json'));
      fs.mkdirSync(path.join(tmp, 'src', 'auth'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src', 'auth', 'token.js'), 'module.exports = 1;\n');
      git('add', '.');
      git('commit', '-qm', 'change');
      const r = collectRiskFlags({ cwd: tmp, base });
      assert.equal(r.ok, true, r.message);
      assert.deepEqual(flagsOf(r, 'new_dependency').map((f) => f.detail), ['left-pad (dependencies)']);
      assert.deepEqual(flagsOf(r, 'security_sensitive_path').map((f) => f.path), ['src/auth/token.js']);
      assert.equal(r.base, base);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('collectRiskFlags fails cleanly on an unknown base', () => {
    const r = collectRiskFlags({ cwd: os.tmpdir(), base: 'no-such-ref-xyz' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'GIT_DIFF_FAILED');
  });
});
