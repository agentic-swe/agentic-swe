'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  parseArgs,
  configureOpenCode,
  confirmChanges,
  setup,
} = require('../scripts/setup.cjs');
const { uninstall } = require('../scripts/lib/install-state/lifecycle.cjs');

const packRoot = path.resolve(__dirname, '..');

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-swe-setup-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function gitRepository(t) {
  const directory = temporaryDirectory(t);
  const result = spawnSync('git', ['init', '-q', directory], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return directory;
}

test('parseArgs supports repeated hosts and target paths', () => {
  const options = parseArgs([
    '--host', 'codex',
    '--host', 'opencode',
    '--target', '.',
    '--no-gitignore',
    '--yes',
  ]);
  assert.deepEqual(options.hosts, ['codex', 'opencode']);
  assert.equal(options.target, process.cwd());
  assert.equal(options.gitignore, false);
  assert.equal(options.yes, true);
  assert.equal(parseArgs(['--allow-non-git']).allowNonGit, true);
});

test('setup installs a portable pack for Codex and OpenCode', (t) => {
  const target = gitRepository(t);
  fs.writeFileSync(path.join(target, 'AGENTS.md'), 'keep my project instructions\n');

  const result = setup(
    { hosts: ['codex', 'opencode'], target, dryRun: false, gitignore: true },
    { packRoot, home: temporaryDirectory(t), skipDependencyInstall: true },
  );

  assert.deepEqual(result.hosts, ['codex', 'opencode']);
  assert.match(fs.readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), /Hypervisor Policy/);
  assert.equal(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8'), 'keep my project instructions\n');
  assert.equal(fs.readFileSync(path.join(target, '.gitignore'), 'utf8'), '.worklogs/\n');
  assert.ok(fs.existsSync(path.join(target, '.agentic-swe', 'phases')));
  assert.ok(fs.existsSync(path.join(target, '.agentic-swe', '.opencode', 'plugins', 'agentic-swe.js')));

  const config = JSON.parse(fs.readFileSync(path.join(target, 'opencode.json'), 'utf8'));
  assert.deepEqual(config.plugins, [{
    name: 'agentic-swe',
    entry: '.agentic-swe/.opencode/plugins/agentic-swe.js',
  }]);
});

test('configureOpenCode updates an existing agentic-swe entry without duplicates', (t) => {
  const target = temporaryDirectory(t);
  fs.writeFileSync(path.join(target, 'opencode.json'), JSON.stringify({
    plugins: [{ name: 'agentic-swe', entry: 'old.js' }, 'another-plugin'],
  }));

  configureOpenCode(target, false);

  const config = JSON.parse(fs.readFileSync(path.join(target, 'opencode.json'), 'utf8'));
  assert.equal(config.plugins.length, 2);
  assert.equal(config.plugins[0].entry, '.agentic-swe/.opencode/plugins/agentic-swe.js');
});

test('setup safely installs and merges native lifecycle adapters', (t) => {
  const target = gitRepository(t);
  const home = temporaryDirectory(t);
  const codexHooks = path.join(target, '.codex', 'hooks.json');
  fs.mkdirSync(path.dirname(codexHooks), { recursive: true });
  fs.writeFileSync(codexHooks, `${JSON.stringify({
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'echo existing' }] }],
    },
  })}\n`);

  setup(
    {
      hosts: ['codex', 'antigravity', 'windsurf', 'kiro', 'copilot', 'vscode'],
      target,
      dryRun: false,
      gitignore: false,
    },
    { packRoot, home, skipDependencyInstall: true },
  );

  const beforeUpgrade = JSON.parse(fs.readFileSync(codexHooks, 'utf8'));
  beforeUpgrade.hooks.SessionStart[1].hooks[0].command = beforeUpgrade.hooks.SessionStart[1].hooks[0].command
    .replace('host-lifecycle.cjs', 'legacy-host-lifecycle.cjs');
  fs.writeFileSync(codexHooks, `${JSON.stringify(beforeUpgrade, null, 2)}\n`);
  const antigravityHooks = path.join(target, '.agents', 'hooks.json');
  const editedAntigravity = JSON.parse(fs.readFileSync(antigravityHooks, 'utf8'));
  editedAntigravity.customHook = { PreInvocation: [{ type: 'command', command: 'echo custom' }] };
  fs.writeFileSync(antigravityHooks, `${JSON.stringify(editedAntigravity, null, 2)}\n`);

  setup(
    {
      hosts: ['codex', 'antigravity', 'windsurf', 'kiro', 'copilot', 'vscode'],
      target,
      dryRun: false,
      gitignore: false,
    },
    { packRoot, home, skipDependencyInstall: true },
  );

  const mergedCodex = JSON.parse(fs.readFileSync(codexHooks, 'utf8'));
  assert.equal(mergedCodex.hooks.SessionStart.length, 2, 'existing Codex hooks must be preserved');
  assert.doesNotMatch(JSON.stringify(mergedCodex), /legacy-host-lifecycle/);
  assert.ok(fs.existsSync(path.join(target, '.agents', 'hooks.json')));
  assert.ok(fs.existsSync(path.join(target, '.windsurf', 'hooks.json')));
  assert.ok(fs.existsSync(path.join(target, '.kiro', 'hooks', 'agentic-swe-memory.json')));
  assert.ok(fs.existsSync(path.join(target, '.github', 'hooks', 'agentic-swe-memory.json')));
  assert.ok(fs.existsSync(path.join(
    home,
    '.vscode',
    'extensions',
    'agentic-swe.agentic-swe-lifecycle-3.3.1',
    'extension.js',
  )));

  uninstall({ destination: path.join(target, '.agentic-swe'), dryRun: false });
  const preservedAntigravity = JSON.parse(fs.readFileSync(antigravityHooks, 'utf8'));
  assert.deepEqual(preservedAntigravity, {
    customHook: { PreInvocation: [{ type: 'command', command: 'echo custom' }] },
  });
});

test('uninstall removes only merged Agentic SWE hooks from an existing host file', (t) => {
  const target = gitRepository(t);
  const codexHooks = path.join(target, '.codex', 'hooks.json');
  fs.mkdirSync(path.dirname(codexHooks), { recursive: true });
  fs.writeFileSync(codexHooks, `${JSON.stringify({
    hooks: {
      SessionStart: [{
        hooks: [{
          type: 'command',
          command: 'node custom-wrapper.js --host codex --event start',
        }],
      }],
    },
  }, null, 2)}\n`);

  setup(
    { hosts: ['codex'], target, dryRun: false, gitignore: false },
    { packRoot, home: temporaryDirectory(t), skipDependencyInstall: true },
  );
  uninstall({ destination: path.join(target, '.agentic-swe'), dryRun: false });

  const restored = JSON.parse(fs.readFileSync(codexHooks, 'utf8'));
  assert.deepEqual(restored, {
    hooks: {
      SessionStart: [{
        hooks: [{
          type: 'command',
          command: 'node custom-wrapper.js --host codex --event start',
        }],
      }],
    },
  });
});

test('dry-run reports changes without writing files', (t) => {
  const target = temporaryDirectory(t);
  const result = setup(
    {
      hosts: ['cursor', 'codex', 'antigravity', 'windsurf', 'kiro', 'copilot', 'vscode'],
      target,
      dryRun: true,
      gitignore: true,
      allowNonGit: true,
    },
    { packRoot, home: temporaryDirectory(t), skipDependencyInstall: true },
  );

  assert.ok(result.changes.some((change) => change.startsWith('Would merge policy')));
  assert.ok(result.changes.some((change) => change.includes('Windsurf hooks')));
  assert.ok(result.changes.some((change) => change.includes('VS Code extension')));
  assert.deepEqual(fs.readdirSync(target), []);
});

test('setup refuses a directory that is not a git repository', (t) => {
  const target = temporaryDirectory(t);
  assert.throws(
    () => setup(
      { hosts: ['codex'], target, dryRun: true, gitignore: true },
      { packRoot, home: temporaryDirectory(t), skipDependencyInstall: true },
    ),
    /not a git repository/,
  );
  assert.deepEqual(fs.readdirSync(target), []);
});

test('setup refuses a subdirectory of a repository', (t) => {
  const root = gitRepository(t);
  const target = path.join(root, 'nested');
  fs.mkdirSync(target);
  assert.throws(
    () => setup(
      { hosts: ['codex'], target, dryRun: true, gitignore: true },
      { packRoot, home: temporaryDirectory(t), skipDependencyInstall: true },
    ),
    /not at its root/,
  );
  assert.deepEqual(fs.readdirSync(target), []);
});

test('setup refuses to replace a Cursor plugin that is a git checkout', (t) => {
  const target = gitRepository(t);
  const home = temporaryDirectory(t);
  const plugin = path.join(home, '.cursor', 'plugins', 'local', 'agentic-swe');
  fs.mkdirSync(path.join(plugin, '.git'), { recursive: true });
  assert.throws(
    () => setup(
      { hosts: ['cursor'], target, dryRun: false, gitignore: false },
      { packRoot, home, skipDependencyInstall: true },
    ),
    /git checkout/,
  );
  assert.ok(fs.existsSync(path.join(plugin, '.git')));
  assert.equal(fs.existsSync(path.join(target, 'CLAUDE.md')), false);
});

test('setup --help lists --accept-risk', () => {
  const bin = path.join(packRoot, 'scripts', 'setup.cjs');
  const result = spawnSync('node', [bin, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--accept-risk/);
});

test('confirmation accepts only an explicit yes', async () => {
  const preview = { target: '/repo', hosts: ['cursor'], changes: ['Would merge policy'] };
  assert.equal(await confirmChanges(preview, async () => 'y'), true);
  assert.equal(await confirmChanges(preview, async () => 'yes'), true);
  assert.equal(await confirmChanges(preview, async () => ''), false);
  assert.equal(await confirmChanges(preview, async () => 'n'), false);
});
