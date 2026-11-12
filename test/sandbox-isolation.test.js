'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { scanInstallPackage } = require('../scripts/lib/skills/install-scan.cjs');
const { installSkill } = require('../scripts/lib/skills/skill-registry.cjs');
const { digestSkillBody } = require('../scripts/lib/skills/skill-integrity.cjs');
const { readJournal } = require('../scripts/lib/shared/journal.cjs');
const {
  runIsolatedFixture,
  assertWriteContained,
  assertNetworkContained,
  runWithTimeoutKill,
} = require('../scripts/lib/tools/index.cjs');

const fixtures = path.join(__dirname, 'fixtures', 'sandbox-malicious');
const allowDecision = {
  decision: 'allow',
  rule_id: 'test.allow',
  policy_digest: 'a'.repeat(64),
  risk_class: 'low',
  reason: 'test',
};

function work() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-iso-'));
  const workDir = path.join(rootDir, '.worklogs', 'item');
  fs.mkdirSync(workDir, { recursive: true });
  return { rootDir, workDir };
}

function writeInstallable(dir, name, bodyExtra = '') {
  fs.mkdirSync(dir, { recursive: true });
  const skillMd = `---
name: ${name}
description: "Isolation fixture ${name}"
metadata:
  version: "1.0.0"
  eval_status: "unevaluated"
  eval_ref: ""
---
# ${name}
${bodyExtra}`;
  const digest = digestSkillBody(skillMd);
  const manifest = {
    name,
    version: '1.0.0',
    description: `Isolation fixture ${name}`,
    kind: 'prompt',
    inputs: [],
    outputs: [],
    dependencies: [],
    permissions: [],
    runtime: { node: '>=22.0.0' },
    compatibility: { pack: '^3.0.0' },
    validation: { rules: ['schema'] },
    provenance: { origin: 'first-party', authors: ['test'] },
    maintainer: 'test',
    digest,
  };
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

describe('AE-027b isolation tests, scanning, malicious fixtures', () => {
  it('AC1: env-stealer fixture is contained (no secret echo under sandbox env)', async () => {
    const { rootDir, workDir } = work();
    const steal = path.join(fixtures, 'env-stealer', 'steal.cjs');
    const report = await runIsolatedFixture({
      argv: [process.execPath, steal],
      cwd: path.dirname(steal),
      cwd_root: path.dirname(steal),
      decision: allowDecision,
      workDir,
      plantSecrets: {
        GITHUB_TOKEN: 'ghp_must_not_echo_aa',
        NPM_TOKEN: 'npm_must_not_echo_bb',
      },
    });
    assert.equal(report.contained, true, report.message);
    assert.equal(report.leaks.length, 0);
    assert.doesNotMatch(report.stdout + report.stderr, /ghp_must_not_echo|npm_must_not_echo/);
    // Fixture exits 2 when secrets absent — contained success path.
    assert.equal(report.exit_code, 2);
    const events = readJournal(workDir).events;
    assert.ok(events.some((e) => e.type === 'sandbox.isolation.passed'));
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('AC1: network beacon blocked by sandbox fetch gate and by install scan', async () => {
    const denied = await assertNetworkContained('plugin-untrusted', 'https://evil.example.invalid/beacon');
    assert.equal(denied.ok, false);
    assert.equal(denied.error.code, 'SANDBOX_NETWORK_DENIED');

    const scan = scanInstallPackage(path.join(fixtures, 'network-beacon'));
    assert.equal(scan.ok, false);
    assert.equal(scan.code, 'SCAN_FAILED');
    assert.ok(scan.findings.some((f) => f.id === 'network-beacon'));
  });

  it('AC1: symlink escape and write-outside-allow-list are blocked', () => {
    const scan = scanInstallPackage(path.join(fixtures, 'symlink-escape', 'pkg'));
    assert.equal(scan.ok, false);
    assert.ok(scan.findings.some((f) => f.id === 'symlink-escape'), JSON.stringify(scan.findings));

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-write-'));
    try {
      const denied = assertWriteContained(
        { profile: 'plugin-untrusted', cwd_root: root, fs_write: ['out/**'] },
        path.join('..', 'pwned.txt'),
        { cwd_root: root, fs_write: ['out/**'] }
      );
      assert.equal(denied.ok, false);
      assert.equal(denied.code, 'SANDBOX_FS_DENIED');
      const ok = assertWriteContained(
        { profile: 'plugin-untrusted', cwd_root: root, fs_write: ['out/**'] },
        path.join('out', 'ok.txt'),
        { cwd_root: root, fs_write: ['out/**'] }
      );
      assert.equal(ok.ok, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('AC1: forever-spawn pattern is refused by scan (not executed live)', () => {
    const scan = scanInstallPackage(path.join(fixtures, 'forever-spawn'));
    assert.equal(scan.ok, false);
    assert.ok(scan.findings.some((f) => f.id === 'forever-spawn'), JSON.stringify(scan.findings));
  });

  it('AC2: install of a package with failing scan is refused', () => {
    const registry = fs.mkdtempSync(path.join(os.tmpdir(), 'reg-scan-'));
    const src = path.join(registry, 'src-bad');
    try {
      writeInstallable(src, 'evil-skill');
      fs.copyFileSync(
        path.join(fixtures, 'env-stealer', 'steal.cjs'),
        path.join(src, 'steal.cjs')
      );
      const refused = installSkill({ registryRoot: path.join(registry, 'reg'), sourceDir: src });
      assert.equal(refused.ok, false);
      assert.equal(refused.code, 'SCAN_FAILED');
      assert.ok(Array.isArray(refused.findings) && refused.findings.length > 0);
      assert.equal(fs.existsSync(path.join(registry, 'reg', 'skills', 'evil-skill')), false);

      // Clean package still installs.
      const clean = path.join(registry, 'src-clean');
      writeInstallable(clean, 'clean-skill');
      const ok = installSkill({ registryRoot: path.join(registry, 'reg'), sourceDir: clean });
      assert.equal(ok.ok, true, JSON.stringify(ok));
    } finally {
      fs.rmSync(registry, { recursive: true, force: true });
    }
  });

  it('AC2b: blank/null scan root and corrupt package.json fail closed', () => {
    assert.equal(scanInstallPackage('').code, 'SCAN_ROOT_INVALID');
    assert.equal(scanInstallPackage(null).code, 'SCAN_ROOT_INVALID');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-corrupt-'));
    try {
      fs.writeFileSync(path.join(tmp, 'package.json'), '{not-json');
      const scan = scanInstallPackage(tmp);
      assert.equal(scan.ok, false);
      assert.ok(scan.findings.some((f) => f.id === 'package-json-corrupt'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('AC3: timeout/kill leaves no orphan privilege escalation path', async () => {
    const report = await runWithTimeoutKill({
      argv: [process.execPath, path.join(fixtures, 'forever-spawn', 'loop.cjs')],
      cwd: path.join(fixtures, 'forever-spawn'),
      decision: allowDecision,
      timeout_ms: 30,
      plantSecrets: { GITHUB_TOKEN: 'ghp_orphan_check' },
    });
    assert.equal(report.orphan_escalation, false);
    assert.equal(report.timed_out, true);
    assert.equal(report.contained, true);
    assert.doesNotMatch(report.stdout + report.stderr, /ghp_orphan_check/);
  });

  it('AC4: failures surface as structured errors + journal events; CI harness exits non-zero', () => {
    const { rootDir, workDir } = work();
    const scan = scanInstallPackage(path.join(fixtures, 'env-stealer'));
    assert.equal(scan.ok, false);
    assert.equal(typeof scan.code, 'string');
    assert.ok(scan.findings.length > 0);

    // Journal a structured failure event (same shape isolation harness uses).
    const { appendEvent } = require('../scripts/lib/shared/journal.cjs');
    appendEvent(workDir, {
      type: 'sandbox.isolation.failed',
      payload: { code: scan.code, findings: scan.findings.map((f) => f.id) },
    });
    const events = readJournal(workDir).events;
    assert.ok(events.some((e) => e.type === 'sandbox.isolation.failed'));

    // CI-shaped runner: exit non-zero when scan fails.
    const runner = path.join(rootDir, 'scan-ci.cjs');
    fs.writeFileSync(
      runner,
      `'use strict';
const { scanInstallPackage } = require(${JSON.stringify(path.join(__dirname, '..', 'scripts/lib/skills/install-scan.cjs'))});
const r = scanInstallPackage(process.argv[2]);
if (!r.ok) {
  console.error(JSON.stringify({ code: r.code, findings: r.findings }));
  process.exit(1);
}
process.exit(0);
`
    );
    const failed = spawnSync(process.execPath, [runner, path.join(fixtures, 'env-stealer')], {
      encoding: 'utf8',
    });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /SCAN_FAILED|env-stealer/);

    const cleanDir = path.join(rootDir, 'clean');
    fs.mkdirSync(cleanDir);
    fs.writeFileSync(path.join(cleanDir, 'README.md'), 'ok\n');
    const passed = spawnSync(process.execPath, [runner, cleanDir], { encoding: 'utf8' });
    assert.equal(passed.status, 0);

    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('policy deny still yields zero spawn in isolation harness', async () => {
    let spawns = 0;
    const report = await runIsolatedFixture({
      argv: [process.execPath, '--version'],
      cwd: process.cwd(),
      decision: {
        decision: 'deny',
        rule_id: 'x',
        policy_digest: 'c'.repeat(64),
        risk_class: 'high',
        reason: 'no',
        code: 'POLICY_DENIED',
      },
      spawn: () => {
        spawns += 1;
        throw new Error('must not spawn');
      },
    });
    assert.equal(report.spawned, false);
    assert.equal(spawns, 0);
    assert.equal(report.contained, true);
  });
});
