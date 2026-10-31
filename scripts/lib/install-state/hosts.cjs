'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SUPPORTED_HOSTS = [
  'claude-code',
  'cursor',
  'vscode',
  'codex',
  'opencode',
  'antigravity',
  'windsurf',
  'kiro',
  'copilot',
];
const PORTABLE_ENTRIES = [
  'commands', 'phases', 'agents', 'templates', 'references', 'tools', 'skills',
  'scripts', 'schemas', 'config', 'hooks', 'state-machine.json', 'CLAUDE.md',
  'AGENTS.md', 'GEMINI.md', '.opencode', '.codex-plugin', 'integrations', 'mcp-servers.json',
  'package.json',
];

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
    antigravity:
      commandExists('antigravity') ||
      fs.existsSync(path.join(home, '.gemini', 'antigravity')) ||
      fs.existsSync(path.join(home, '.gemini', 'antigravity-ide')),
    windsurf: commandExists('windsurf') || fs.existsSync(path.join(home, '.codeium', 'windsurf')),
    kiro: commandExists('kiro') || fs.existsSync(path.join(home, '.kiro')),
    copilot: commandExists('copilot') || fs.existsSync(path.join(home, '.copilot')),
  };
  return SUPPORTED_HOSTS.filter((host) => checks[host]);
}

module.exports = { SUPPORTED_HOSTS, PORTABLE_ENTRIES, commandExists, detectHosts };
