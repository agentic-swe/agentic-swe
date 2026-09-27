#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { runMaintenance } = require('./lib/hooks/lifecycle.cjs');
const { buildPrimeMarkdown } = require('./lib/memory/memory-prime.cjs');
const { loadMergedMemoryConfig, sqlitePathForProject } = require('./lib/memory/config.cjs');
const { getDefaultPluginRoot } = require('./lib/work-engine/engine.cjs');
const { readRecentReceipts } = require('./lib/hooks/hook-receipt.cjs');

const pluginRoot = getDefaultPluginRoot();
const protocolVersion = '2025-06-18';
const serverRoot = fs.realpathSync.native(path.resolve(process.env.AGENTIC_SWE_PROJECT_ROOT || process.cwd()));

function content(text) {
  return { content: [{ type: 'text', text: String(text) }] };
}

function projectRootFrom(args) {
  const requested = fs.realpathSync.native(path.resolve(args?.projectRoot || serverRoot));
  const relative = path.relative(serverRoot, requested);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error(`projectRoot must stay within ${serverRoot}`), { code: -32602 });
  }
  return requested;
}

async function callTool(name, args) {
  const projectRoot = projectRootFrom(args);
  if (name === 'agentic_swe_memory_refresh') {
    const result = await runMaintenance({ projectRoot, pluginRoot, hook: 'mcp:refresh' });
    return content(JSON.stringify(result, null, 2));
  }
  if (name === 'agentic_swe_memory_prime') {
    const markdown = await buildPrimeMarkdown({
      projectRoot,
      pluginRoot,
      query: args?.query || '',
      workId: args?.workId || null,
    });
    return content(markdown);
  }
  if (name === 'agentic_swe_memory_status') {
    const merged = loadMergedMemoryConfig(pluginRoot, projectRoot);
    const sqlitePath = sqlitePathForProject(merged, projectRoot);
    const result = {
      projectRoot,
      sqlitePath,
      databaseExists: fs.existsSync(sqlitePath),
      receipts: readRecentReceipts(projectRoot, 8),
    };
    return content(JSON.stringify(result, null, 2));
  }
  throw new Error(`unknown tool: ${name}`);
}

const tools = [
  {
    name: 'agentic_swe_memory_refresh',
    description: 'Incrementally index changed repository memory, refresh lessons, and quarantine bad procedures.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'agentic_swe_memory_prime',
    description: 'Retrieve a bounded Agentic SWE memory digest for the current task.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string' },
        query: { type: 'string' },
        workId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'agentic_swe_memory_status',
    description: 'Inspect the local memory database and recent lifecycle receipts.',
    inputSchema: {
      type: 'object',
      properties: {
        projectRoot: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return;
  if (message.id === undefined) return;
  try {
    let result;
    if (message.method === 'initialize') {
      result = {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agentic-swe-memory', version: '3.3.1' },
      };
    } else if (message.method === 'ping') {
      result = {};
    } else if (message.method === 'tools/list') {
      result = { tools };
    } else if (message.method === 'tools/call') {
      result = await callTool(message.params?.name, message.params?.arguments || {});
    } else {
      throw Object.assign(new Error(`method not found: ${message.method}`), { code: -32601 });
    }
    send({ jsonrpc: '2.0', id: message.id, result });
  } catch (error) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: {
        code: error.code || -32603,
        message: error && error.message ? error.message : String(error),
      },
    });
  }
}

if (require.main === module) {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    try {
      handle(JSON.parse(line));
    } catch (error) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message } });
    }
  });
}

module.exports = {
  callTool,
  handle,
  tools,
};
