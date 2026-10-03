#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { runMaintenance } = require('./lib/hooks/lifecycle.cjs');
const { writeHookReceipt } = require('./lib/hooks/hook-receipt.cjs');

function parseArgs(argv) {
  const out = { host: 'unknown', event: 'start', json: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--host') out.host = argv[++i];
    else if (arg === '--event') out.event = argv[++i];
    else if (arg === '--project-root') out.projectRoot = path.resolve(argv[++i]);
    else if (arg === '--plugin-root') out.pluginRoot = path.resolve(argv[++i]);
    else if (arg === '--json') out.json = true;
  }
  return out;
}

function readPayload() {
  if (process.stdin.isTTY) return {};
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function firstString(values) {
  return values.find((value) => typeof value === 'string' && value.trim()) || null;
}

/**
 * Resolve paths for host payloads. On Windows, keep POSIX-absolute strings as-is so
 * Unix-style host fixtures (and cross-platform tests) are not rewritten to C:\...
 */
function resolveHostPath(p) {
  if (!p) return p;
  const s = String(p);
  if (process.platform === 'win32' && s.startsWith('/') && !/^[A-Za-z]:/.test(s)) {
    return s.replace(/\\/g, '/');
  }
  return path.resolve(s);
}

function normalizePayload(payload, explicitRoot) {
  const tool = payload.tool_info || payload.toolInfo || {};
  const workspacePaths = payload.workspacePaths || payload.workspace_paths || payload.workspace_roots || [];
  const projectRoot =
    explicitRoot ||
    firstString([
      payload.cwd,
      tool.cwd,
      tool.root_workspace_path,
      tool.rootWorkspacePath,
      payload.root_workspace_path,
      payload.rootWorkspacePath,
      Array.isArray(workspacePaths) ? workspacePaths[0] : null,
      process.cwd(),
    ]);
  const transcriptPath = firstString([
    payload.transcript_path,
    payload.transcriptPath,
    tool.transcript_path,
    tool.transcriptPath,
  ]);
  return {
    projectRoot: resolveHostPath(projectRoot || process.cwd()),
    transcriptPath: transcriptPath ? resolveHostPath(transcriptPath) : null,
  };
}

function runCapture({ projectRoot, pluginRoot, transcriptPath, payload }) {
  const args = [
    path.join(pluginRoot, 'scripts', 'session-capture.cjs'),
    '--project-root',
    projectRoot,
    '--plugin-root',
    pluginRoot,
    '--json',
  ];
  if (transcriptPath) args.push('--transcript-path', transcriptPath);
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    input: JSON.stringify({
      ...payload,
      cwd: projectRoot,
      ...(transcriptPath ? { transcript_path: transcriptPath } : {}),
    }),
    env: process.env,
    timeout: Number(process.env.AGENTIC_SWE_HOST_HOOK_TIMEOUT_MS || 120000),
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `capture exited ${result.status}`).trim());
  }
  try {
    return JSON.parse(result.stdout || '{}');
  } catch {
    return { ok: true, output: result.stdout.trim() };
  }
}

async function runHostLifecycle(opts) {
  const pluginRoot = path.resolve(opts.pluginRoot || getDefaultPluginRoot());
  const normalized = normalizePayload(opts.payload || {}, opts.projectRoot);
  const hook = `${opts.host}:${opts.event}`;
  try {
    let result;
    if (opts.event === 'start' || opts.event === 'prompt') {
      result = await runMaintenance({
        projectRoot: normalized.projectRoot,
        pluginRoot,
        hook,
      });
    } else if (normalized.transcriptPath) {
      result = runCapture({
        projectRoot: normalized.projectRoot,
        pluginRoot,
        transcriptPath: normalized.transcriptPath,
        payload: opts.payload || {},
      });
    } else {
      result = await runMaintenance({
        projectRoot: normalized.projectRoot,
        pluginRoot,
        hook,
      });
      result.capture = { skipped: 'host payload did not provide a transcript path' };
    }
    return {
      ok: result.ok !== false,
      host: opts.host,
      event: opts.event,
      projectRoot: normalized.projectRoot,
      transcriptPath: normalized.transcriptPath,
      result,
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    writeHookReceipt({
      projectRoot: normalized.projectRoot,
      hook,
      ok: false,
      failures: [{ step: 'host-adapter', message }],
    });
    return {
      ok: false,
      host: opts.host,
      event: opts.event,
      projectRoot: normalized.projectRoot,
      transcriptPath: normalized.transcriptPath,
      error: message,
    };
  }
}

function hostOutput(host, event) {
  if (host === 'antigravity') {
    if (event === 'start' || event === 'prompt') return { injectSteps: [] };
    return { decision: 'stop' };
  }
  return {};
}

async function main() {
  const args = parseArgs(process.argv);
  const result = await runHostLifecycle({
    ...args,
    payload: readPayload(),
  });
  if (result.ok) {
    const output = args.json ? result : hostOutput(args.host, args.event);
    process.stdout.write(`${JSON.stringify(output)}\n`);
  } else {
    process.stderr.write(`${JSON.stringify(result)}\n`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  hostOutput,
  normalizePayload,
  runHostLifecycle,
};
