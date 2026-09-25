#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { mergeClaudePolicy } = require('./merge-claude-policy.js');

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
  --no-gitignore
               Do not add .worklogs/ to the target .gitignore.
  --yes        Accepted for scripts; setup is already non-interactive.
`);
}

function parseArgs(argv) {
  const opts = { hosts: [], target: process.cwd(), dryRun: false, gitignore: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--host' && argv[i + 1]) opts.hosts.push(argv[++i]);
    else if (arg === '--target' && argv[i + 1]) opts.target = path.resolve(argv[++i]);
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-gitignore') opts.gitignore = false;
    else if (arg === '--yes') continue;
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

function copyEntry(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: true });
}

function installPortablePack(packRoot, target, dryRun) {
  const destination = path.join(target, '.agentic-swe');
  if (dryRun) return destination;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of PORTABLE_ENTRIES) {
    copyEntry(path.join(packRoot, entry), path.join(destination, entry));
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

function installCursor(packRoot, home, dryRun) {
  const destination = path.join(home, '.cursor', 'plugins', 'local', 'agentic-swe');
  if (dryRun) return destination;
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of PORTABLE_ENTRIES.concat(['.cursor-plugin', '.claude-plugin', 'package.json'])) {
    copyEntry(path.join(packRoot, entry), path.join(destination, entry));
  }
  return destination;
}

function installAgentsFile(packRoot, target, dryRun) {
  const destination = path.join(target, 'AGENTS.md');
  if (!dryRun && !fs.existsSync(destination)) {
    fs.copyFileSync(path.join(packRoot, 'AGENTS.md'), destination);
  }
  return destination;
}

function configureOpenCode(target, dryRun) {
  const configFile = path.join(target, 'opencode.json');
  const entry = { name: 'agentic-swe', entry: '.agentic-swe/.opencode/plugins/agentic-swe.js' };
  if (dryRun) return configFile;
  let config = {};
  if (fs.existsSync(configFile)) {
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
  return configFile;
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
  const hosts = options.hosts.length ? options.hosts : detectHosts(home);
  if (!hosts.length) {
    throw new Error(`no supported host detected; pass --host ${SUPPORTED_HOSTS[0]} (or another host)`);
  }

  const changes = [];
  if (options.dryRun) {
    changes.push(`Would merge policy into ${path.join(target, 'CLAUDE.md')}`);
  } else {
    const result = mergeClaudePolicy({
      packRoot,
      targetDir: target,
      gitignore: options.gitignore,
    });
    changes.push(`${result.action}: ${result.targetFile}`);
  }

  const portableHosts = hosts.filter((host) => !['claude-code', 'cursor'].includes(host));
  if (portableHosts.length) {
    const destination = installPortablePack(packRoot, target, options.dryRun);
    if (!context.skipDependencyInstall) installRuntimeDependencies(destination, options.dryRun);
    changes.push(`Installed portable pack: ${destination}`);
  }
  if (hosts.includes('cursor')) {
    const destination = installCursor(packRoot, home, options.dryRun);
    if (!context.skipDependencyInstall) installRuntimeDependencies(destination, options.dryRun);
    changes.push(`Installed Cursor plugin: ${destination}`);
  }
  if (hosts.includes('claude-code')) {
    runClaudeInstall(options.dryRun);
    changes.push(options.dryRun ? 'Would install the Claude Code plugin' : 'Installed Claude Code plugin');
  }
  if (hosts.some((host) => ['vscode', 'codex'].includes(host))) {
    changes.push(`Prepared agent policy: ${installAgentsFile(packRoot, target, options.dryRun)}`);
  }
  if (hosts.includes('opencode')) {
    changes.push(`Updated OpenCode config: ${configureOpenCode(target, options.dryRun)}`);
  }
  if (hosts.includes('antigravity') && !options.dryRun && !fs.existsSync(path.join(target, 'GEMINI.md'))) {
    fs.copyFileSync(path.join(packRoot, 'GEMINI.md'), path.join(target, 'GEMINI.md'));
    changes.push(`Prepared Antigravity policy: ${path.join(target, 'GEMINI.md')}`);
  }

  return { hosts, target, changes };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      usage();
      return;
    }
    const result = setup(options);
    console.log(`Agentic SWE configured for: ${result.hosts.join(', ')}`);
    for (const change of result.changes) console.log(`- ${change}`);
    if (result.hosts.includes('cursor')) console.log('- Reload Cursor to activate the plugin.');
  } catch (error) {
    console.error(`error: ${error.message || error}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
else module.exports = {
  SUPPORTED_HOSTS,
  parseArgs,
  detectHosts,
  installPortablePack,
  installRuntimeDependencies,
  configureOpenCode,
  setup,
};
