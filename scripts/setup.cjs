#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { mergeClaudePolicy } = require('./merge-claude-policy.js');
const { scanSurfaces } = require('./lib/agent-surface/scan.cjs');
const { writeManifest, isRuntimePath } = require('./lib/install-state/manifest.cjs');
const { sha256File } = require('./lib/install-state/hash.cjs');
const { beginTransaction, recordCreated, rollback } = require('./lib/install-state/transaction.cjs');
const { resolveProfile } = require('./lib/install-state/profiles.cjs');

const SUPPORTED_HOSTS = ['claude-code', 'cursor', 'vscode', 'codex', 'opencode', 'antigravity'];
const PORTABLE_ENTRIES = [
  'commands', 'phases', 'agents', 'templates', 'references', 'tools', 'skills',
  'scripts', 'schemas', 'config', 'hooks', 'state-machine.json', 'CLAUDE.md',
  'AGENTS.md', 'GEMINI.md', '.opencode', 'package.json',
];

function usage() {
  console.log(`agentic-swe setup

Usage:
  agentic-swe setup [--host <name|all>] [--target <repo>] [--dry-run]

Hosts:
  ${SUPPORTED_HOSTS.join(', ')}

Options:
  --host       Configure one host. Repeat the flag, or use "all".
               Without this flag, installed hosts are detected.
  --target     Project repository to configure (default: current directory).
  --dry-run    Print the planned changes without writing files.
  --yes        Write the changes without asking. Required when there is no terminal.
  --allow-non-git
               Configure a directory that is not a git repository.
  --no-gitignore
               Do not add .worklogs/ to the target .gitignore.
  --profile    Install profile: core (default), minimal, or full.
  --with       Add a capability pack (repeatable). Use with core or minimal.
  --accept-risk "<reason>"
               Write the installation despite a critical agent-surface finding
               and record a receipt with the given non-empty reason.
`);
}

function parseArgs(argv) {
  const opts = {
    hosts: [], target: process.cwd(), dryRun: false, gitignore: true, yes: false, allowNonGit: false,
    acceptRisk: '', profile: 'core', withCapabilities: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--host' && argv[i + 1]) opts.hosts.push(argv[++i]);
    else if (arg === '--target' && argv[i + 1]) opts.target = path.resolve(argv[++i]);
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-gitignore') opts.gitignore = false;
    else if (arg === '--yes') opts.yes = true;
    else if (arg === '--allow-non-git') opts.allowNonGit = true;
    else if (arg === '--accept-risk') {
      const reason = argv[i + 1];
      if (!reason || reason.startsWith('--')) throw new Error('--accept-risk requires a reason');
      opts.acceptRisk = argv[++i];
    } else if (arg === '--profile' && argv[i + 1]) opts.profile = argv[++i];
    else if (arg === '--with' && argv[i + 1]) opts.withCapabilities.push(argv[++i]);
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (opts.hosts.includes('all')) opts.hosts = [...SUPPORTED_HOSTS];
  opts.hosts = [...new Set(opts.hosts)];
  const invalid = opts.hosts.filter((host) => !SUPPORTED_HOSTS.includes(host));
  if (invalid.length) throw new Error(`unsupported host: ${invalid.join(', ')}`);
  return opts;
}

function commandExists(command) {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'sh', process.platform === 'win32'
    ? [command]
    : ['-c', `command -v ${command}`], { stdio: 'ignore' });
  return result.status === 0;
}

function detectHosts(home = os.homedir()) {
  const checks = {
    'claude-code': commandExists('claude') || fs.existsSync(path.join(home, '.claude')),
    cursor: commandExists('cursor') || fs.existsSync(path.join(home, '.cursor')),
    vscode: commandExists('code') || fs.existsSync(path.join(home, '.vscode')),
    codex: commandExists('codex') || fs.existsSync(path.join(home, '.codex')),
    opencode: commandExists('opencode') || fs.existsSync(path.join(home, '.config', 'opencode')),
    antigravity: commandExists('antigravity') || fs.existsSync(path.join(home, '.antigravity')),
  };
  return SUPPORTED_HOSTS.filter((host) => checks[host]);
}

function plannedPackWrites(packRoot, entries = PORTABLE_ENTRIES) {
  const writes = [];
  function addEntry(relative) {
    // The scanner's own rule definitions necessarily embed literal examples of the unsafe
    // strings they detect (secrets, injection markers, bypass phrases). Scanning that trusted
    // control-plane source as "planned content" would self-trigger a critical finding on every
    // install. It is excluded the same way install-receipts/ and .git/ are excluded: as
    // installer/control-plane data, not agent-execution-surface content.
    if (relative === 'scripts/lib/agent-surface' || relative.startsWith('scripts/lib/agent-surface/')) return;
    const source = path.join(packRoot, relative);
    if (!fs.existsSync(source)) return;
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(source, { withFileTypes: true })) {
        if (child.name === 'node_modules' || child.name === '.git') continue;
        addEntry(`${relative}/${child.name}`);
      }
    } else if (stat.isFile()) {
      writes.push({ path: relative, content: fs.readFileSync(source, 'utf8') });
    }
  }
  for (const entry of entries) addEntry(entry);
  return writes;
}

function gateSetup(packRoot, target, acceptRisk, destination, entries = PORTABLE_ENTRIES, transaction = null) {
  // Scan only the destination about to be written plus the planned pack content, not the
  // whole target repository — unrelated docs elsewhere in the repo must never false-block setup.
  const scan = scanSurfaces({ roots: [destination], plannedWrites: plannedPackWrites(packRoot, entries) });
  if (scan.summary.status !== 'blocked') return scan;
  if (!acceptRisk) throw new Error('critical agent-surface findings');
  const receipts = path.join(destination, 'install-receipts');
  const receiptsDirExisted = fs.existsSync(receipts);
  fs.mkdirSync(receipts, { recursive: true });
  const receipt = path.join(receipts, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(receipt, `${JSON.stringify({
    schema_version: 1,
    created_at: new Date().toISOString(),
    command: 'setup',
    reason: acceptRisk,
    findings: scan.findings.filter((finding) => finding.severity === 'critical'),
  }, null, 2)}\n`);
  if (transaction) {
    // If the receipts directory itself is new, tracking it is enough: rollback removes the
    // directory (and the receipt inside it) recursively. Otherwise track just the receipt file.
    if (!receiptsDirExisted) recordCreated(transaction, receipts);
    else recordCreated(transaction, receipt);
  }
  return {
    ...scan,
    summary: { ...scan.summary, status: 'accepted-risk' },
    receipt: path.relative(destination, receipt),
  };
}

function copyEntry(source, destination, transaction) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (transaction && !fs.existsSync(destination)) recordCreated(transaction, destination);
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function collectOwnedFiles(destination) {
  const files = [];
  function walk(directory, root) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'install-receipts' || entry.name === 'skills') continue;
        walk(full, root);
      } else if (!isRuntimePath(relative)) {
        files.push({ path: relative, sha256: sha256File(full) });
      }
    }
  }
  walk(destination, destination);
  return files;
}

function installPortablePack(packRoot, target, dryRun, transaction, entries = PORTABLE_ENTRIES) {
  const destination = path.join(target, '.agentic-swe');
  if (dryRun) return destination;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of entries) {
    copyEntry(path.join(packRoot, entry), path.join(destination, entry), transaction);
  }
  return destination;
}

function installRuntimeDependencies(destination, dryRun) {
  if (dryRun) return;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: destination,
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`failed to install runtime dependencies in ${destination}`);
}

function gitRoot(directory) {
  const result = spawnSync('git', ['-C', directory, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (result.error && result.error.code === 'ENOENT') {
    throw new Error('git is required so setup can verify the target is one repository');
  }
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

function sameDirectory(left, right) {
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

function assertTargetRepository(target, options) {
  const root = gitRoot(target);
  if (!root) {
    if (options.allowNonGit) return;
    throw new Error(
      `${target} is not a git repository. Setup configures one repository at a time. ` +
      'Change to the repository you want, or pass --allow-non-git for this directory.',
    );
  }
  if (!sameDirectory(root, target)) {
    throw new Error(
      `${target} is inside ${root}, not at its root. Run setup from ${root}, or pass --target ${root}.`,
    );
  }
}

function cursorPluginDestination(home) {
  return path.join(home, '.cursor', 'plugins', 'local', 'agentic-swe');
}

function assertCursorDestination(home, hosts) {
  if (!hosts.includes('cursor')) return;
  const destination = cursorPluginDestination(home);
  if (fs.existsSync(path.join(destination, '.git'))) {
    throw new Error(
      `${destination} is a git checkout. Refusing to replace it. ` +
      'Move it aside yourself if you want setup to install a copy there.',
    );
  }
}

function installCursor(packRoot, home, dryRun, transaction, entries = PORTABLE_ENTRIES) {
  const destination = cursorPluginDestination(home);
  if (dryRun) return destination;
  assertCursorDestination(home, ['cursor']);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  const cursorEntries = new Set([...entries, '.cursor-plugin', '.claude-plugin', 'package.json']);
  for (const entry of cursorEntries) {
    copyEntry(path.join(packRoot, entry), path.join(destination, entry), transaction);
  }
  return destination;
}

function installAgentsFile(packRoot, target, dryRun) {
  const destination = path.join(target, 'AGENTS.md');
  const existed = fs.existsSync(destination);
  if (!dryRun && !existed) {
    fs.copyFileSync(path.join(packRoot, 'AGENTS.md'), destination);
  }
  return { destination, created: !existed && !dryRun };
}

function configureOpenCode(target, dryRun) {
  const configFile = path.join(target, 'opencode.json');
  const entry = { name: 'agentic-swe', entry: '.agentic-swe/.opencode/plugins/agentic-swe.js' };
  const existed = fs.existsSync(configFile);
  if (dryRun) return { configFile, created: !existed, entry };
  let config = {};
  if (existed) {
    try {
      config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch {
      throw new Error(`cannot update non-JSON config safely: ${configFile}`);
    }
  }
  if (!Array.isArray(config.plugins)) config.plugins = [];
  const index = config.plugins.findIndex((plugin) =>
    plugin === 'agentic-swe' || (plugin && typeof plugin === 'object' && plugin.name === 'agentic-swe'));
  if (index >= 0) config.plugins[index] = entry;
  else config.plugins.push(entry);
  fs.writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
  return { configFile, created: !existed, entry };
}

function runClaudeInstall(dryRun) {
  const commands = [
    ['plugin', 'marketplace', 'add', 'agentic-swe/agentic-swe'],
    ['plugin', 'install', 'agentic-swe@agentic-swe-catalog'],
  ];
  if (dryRun) return;
  if (!commandExists('claude')) throw new Error('Claude Code CLI is not installed or not on PATH');
  for (const args of commands) {
    const result = spawnSync('claude', args, { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`claude ${args.join(' ')} failed`);
  }
}

function setup(options, context = {}) {
  const packRoot = context.packRoot || path.resolve(__dirname, '..');
  const home = context.home || os.homedir();
  const target = path.resolve(options.target);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new Error(`target is not a directory: ${target}`);
  }
  assertTargetRepository(target, options);
  const hosts = options.hosts.length ? options.hosts : detectHosts(home);
  if (!hosts.length) {
    throw new Error(`no supported host detected; pass --host ${SUPPORTED_HOSTS[0]} (or another host)`);
  }
  if (!options.dryRun) assertCursorDestination(home, hosts);

  const changes = [];
  const would = (past, future) => (options.dryRun ? `Would ${future}` : past);
  if (options.dryRun) {
    changes.push(`Would merge policy into ${path.join(target, 'CLAUDE.md')}`);
    const portableHosts = hosts.filter((host) => !['claude-code', 'cursor'].includes(host));
    if (portableHosts.length) {
      changes.push(`Would install portable pack: ${path.join(target, '.agentic-swe')}`);
    }
    if (hosts.includes('cursor')) {
      changes.push(`Would install Cursor plugin: ${cursorPluginDestination(home)}`);
    }
    if (hosts.includes('claude-code')) changes.push('Would install Claude Code plugin');
    if (hosts.some((host) => ['vscode', 'codex'].includes(host))) {
      changes.push(`Would prepare agent policy: ${path.join(target, 'AGENTS.md')}`);
    }
    if (hosts.includes('opencode')) {
      changes.push(`Would update OpenCode config: ${path.join(target, 'opencode.json')}`);
    }
    if (hosts.includes('antigravity')) {
      changes.push(`Would prepare Antigravity policy: ${path.join(target, 'GEMINI.md')}`);
    }
    return { hosts, target, changes };
  }

  const packEntries = resolveProfile({
    profile: options.profile || 'core',
    withCapabilities: options.withCapabilities || [],
    packRoot,
  });
  const transaction = beginTransaction();
  const edits = [];
  const external_registrations = [];
  const extraFiles = [];
  const packDestination = path.join(target, '.agentic-swe');
  const toDestinationRelative = (filePath) => path.relative(packDestination, filePath).split(path.sep).join('/');
  try {
    const gateScan = gateSetup(packRoot, target, options.acceptRisk || '', packDestination, packEntries, transaction);
    const last_scan = {
      status: gateScan.summary.status,
      critical: gateScan.summary.critical,
      high: gateScan.summary.high,
      medium: gateScan.summary.medium,
      low: gateScan.summary.low,
      receipt: gateScan.receipt ?? null,
    };

    const result = mergeClaudePolicy({
      packRoot,
      targetDir: target,
      gitignore: options.gitignore,
    });
    changes.push(`${result.action}: ${result.targetFile}`);
    if (result.action === 'created') {
      extraFiles.push({ path: toDestinationRelative(result.targetFile), sha256: sha256File(result.targetFile) });
    } else if (result.action === 'appended' && result.appendedBody !== undefined) {
      edits.push({ type: 'policy-append', path: toDestinationRelative(result.targetFile), body: result.appendedBody });
    }
    if (result.gitignore === 'appended') {
      edits.push({ type: 'gitignore-line', path: toDestinationRelative(path.join(target, '.gitignore')), line: '.worklogs/' });
    }

    const portableHosts = hosts.filter((host) => !['claude-code', 'cursor'].includes(host));
    let packDestinationWritten = null;
    let cursorDestinationWritten = null;
    if (portableHosts.length) {
      packDestinationWritten = installPortablePack(packRoot, target, false, transaction, packEntries);
      if (!context.skipDependencyInstall) installRuntimeDependencies(packDestinationWritten, false);
      changes.push(`${would('Installed', 'install')} portable pack: ${packDestinationWritten}`);
    }
    if (hosts.includes('cursor')) {
      cursorDestinationWritten = installCursor(packRoot, home, false, transaction, packEntries);
      if (!context.skipDependencyInstall) installRuntimeDependencies(cursorDestinationWritten, false);
      changes.push(`${would('Installed', 'install')} Cursor plugin: ${cursorDestinationWritten}`);
    }
    if (hosts.includes('claude-code')) {
      runClaudeInstall(false);
      external_registrations.push({ host: 'claude-code', id: 'agentic-swe@agentic-swe-catalog' });
      changes.push(`${would('Installed', 'install')} Claude Code plugin`);
    }
    if (hosts.some((host) => ['vscode', 'codex'].includes(host))) {
      const agentsResult = installAgentsFile(packRoot, target, false);
      changes.push(`${would('Prepared', 'prepare')} agent policy: ${agentsResult.destination}`);
      if (agentsResult.created) {
        extraFiles.push({ path: toDestinationRelative(agentsResult.destination), sha256: sha256File(agentsResult.destination) });
      }
    }
    if (hosts.includes('opencode')) {
      const opencodeResult = configureOpenCode(target, false);
      changes.push(`${would('Updated', 'update')} OpenCode config: ${opencodeResult.configFile}`);
      if (opencodeResult.created) {
        extraFiles.push({ path: toDestinationRelative(opencodeResult.configFile), sha256: sha256File(opencodeResult.configFile) });
      } else {
        edits.push({
          type: 'json-plugin-entry',
          path: toDestinationRelative(opencodeResult.configFile),
          match: { name: opencodeResult.entry.name, entry: opencodeResult.entry.entry },
        });
      }
    }
    if (hosts.includes('antigravity') && !fs.existsSync(path.join(target, 'GEMINI.md'))) {
      const geminiFile = path.join(target, 'GEMINI.md');
      fs.copyFileSync(path.join(packRoot, 'GEMINI.md'), geminiFile);
      changes.push(`Prepared Antigravity policy: ${geminiFile}`);
      extraFiles.push({ path: toDestinationRelative(geminiFile), sha256: sha256File(geminiFile) });
    }

    if (packDestinationWritten) {
      writeManifest(packDestinationWritten, {
        schema_version: 1,
        installer_version: require('../package.json').version,
        host: portableHosts.length === 1 ? portableHosts[0] : portableHosts.join(','),
        profile: options.profile || 'core',
        files: [...collectOwnedFiles(packDestinationWritten), ...extraFiles],
        edits,
        external_registrations,
        last_scan,
      });
    }
    if (cursorDestinationWritten) {
      writeManifest(cursorDestinationWritten, {
        schema_version: 1,
        installer_version: require('../package.json').version,
        host: 'cursor',
        profile: options.profile || 'core',
        files: collectOwnedFiles(cursorDestinationWritten),
        edits: packDestinationWritten ? [] : edits,
        external_registrations: packDestinationWritten ? [] : external_registrations,
        last_scan,
      });
    }

    return { hosts, target, changes };
  } catch (error) {
    rollback(transaction);
    throw error;
  }
}

function prompt(question) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function confirmChanges(preview, ask) {
  const lines = [
    `This will configure ${preview.target}`,
    `Hosts: ${preview.hosts.join(', ')}`,
    ...preview.changes.map((change) => `- ${change}`),
  ];
  const answer = await ask(lines);
  return /^y(es)?$/i.test(String(answer).trim());
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      usage();
      return;
    }
    if (!options.dryRun && !options.yes) {
      const preview = setup({ ...options, dryRun: true });
      const accepted = await confirmChanges(preview, async (lines) => {
        if (!process.stdin.isTTY) {
          throw new Error('refusing to write without a terminal. Re-run with --yes to confirm, or --dry-run to preview.');
        }
        for (const line of lines) console.log(line);
        return prompt('Write these changes? [y/N] ');
      });
      if (!accepted) {
        console.error('Cancelled. Nothing was written.');
        process.exitCode = 1;
        return;
      }
    }
    const result = setup(options);
    const heading = options.dryRun ? 'Dry run, nothing written. Would configure' : 'Agentic SWE configured for';
    console.log(`${heading}: ${result.hosts.join(', ')}`);
    for (const change of result.changes) console.log(`- ${change}`);
    if (result.hosts.includes('cursor') && !options.dryRun) console.log('- Reload Cursor to activate the plugin.');
  } catch (error) {
    console.error(`error: ${error.message || error}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
else module.exports = {
  SUPPORTED_HOSTS,
  PORTABLE_ENTRIES,
  parseArgs,
  detectHosts,
  assertTargetRepository,
  installPortablePack,
  installRuntimeDependencies,
  configureOpenCode,
  confirmChanges,
  setup,
};
