'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const vscode = require('vscode');

const timers = new Map();
const running = new Map();

function lifecycleScript(root) {
  const candidates = [
    path.join(root, '.agentic-swe', 'scripts', 'host-lifecycle.cjs'),
    path.join(root, 'agentic-swe', 'scripts', 'host-lifecycle.cjs'),
  ];
  return candidates.find((script) => fs.existsSync(script)) || null;
}

function runLifecycle(root, event) {
  const script = lifecycleScript(root);
  if (!script) return Promise.resolve({ skipped: true });
  const key = `${root}:${event}`;
  if (running.has(key)) return running.get(key);
  const operation = new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [script, '--host', 'vscode', '--event', event, '--project-root', root],
      {
        cwd: root,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => resolve({ ok: false, error: error.message }));
    child.on('close', (code) => resolve({ ok: code === 0, code, error: stderr.trim() }));
  }).finally(() => running.delete(key));
  running.set(key, operation);
  return operation;
}

function workspaceRoots() {
  return (vscode.workspace.workspaceFolders || []).map((folder) => folder.uri.fsPath);
}

function schedule(root) {
  clearTimeout(timers.get(root));
  timers.set(root, setTimeout(() => {
    timers.delete(root);
    runLifecycle(root, 'start');
  }, 750));
}

async function refreshAll() {
  const results = await Promise.all(workspaceRoots().map((root) => runLifecycle(root, 'start')));
  const failed = results.filter((result) => result && result.ok === false);
  if (failed.length) {
    vscode.window.showWarningMessage(
      `Agentic SWE memory refresh failed in ${failed.length} workspace${failed.length === 1 ? '' : 's'}.`,
    );
  }
  return results;
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('agentic-swe.refreshMemory', refreshAll),
  );
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{md,json}');
  for (const event of ['onDidCreate', 'onDidChange', 'onDidDelete']) {
    context.subscriptions.push(
      watcher[event]((uri) => {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (folder && !uri.fsPath.includes(`${path.sep}.agentic-swe${path.sep}`)) {
          schedule(folder.uri.fsPath);
        }
      }),
    );
  }
  context.subscriptions.push(watcher);
  refreshAll();
}

async function deactivate() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  await Promise.all(workspaceRoots().map((root) => runLifecycle(root, 'stop')));
}

module.exports = {
  activate,
  deactivate,
  refreshAll,
  runLifecycle,
};
